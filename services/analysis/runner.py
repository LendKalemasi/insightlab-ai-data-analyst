"""Executes validated analysis code in a restricted child process.

Isolation layers, weakest to strongest:
  1. validate_code() rejects disallowed imports, calls and dunder access.
  2. Execution happens in a forked child, so a crash or OOM cannot take down
     the service, and the child is killed on deadline.
  3. The child applies RLIMIT_CPU and RLIMIT_NPROC (NPROC=0 blocks
    fork/subprocess), clears os.environ so secrets are unreachable, and applies
      an address-space budget after scientific libraries are loaded.
  4. Only `pd`, `np` and `df` are exposed; __builtins__ is a reduced mapping.
  5. Output is capped and serialised to JSON; arbitrary objects never escape.

Honest limitation: this is a language-level sandbox, not a kernel one. A CPython
escape (e.g. via a novel pandas path) is not fully excluded. For untrusted
multi-tenant use, run this service under gVisor or a per-request microVM.
"""
from __future__ import annotations

import multiprocessing as mp
import os
import resource
import sys
import time
from io import StringIO
from typing import Any

from validator import validate_code

MAX_OUTPUT_ROWS = 1000
MAX_STDOUT_CHARS = 10_000
MEMORY_LIMIT_BYTES = 512 * 1024 * 1024


def _apply_limits(cpu_seconds: int, *, block_process_creation: bool = False) -> None:
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    if block_process_creation:
        resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))   # no fork, no subprocess
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))   # no file writes
    os.environ.clear()                                   # no secrets in the child


def _apply_memory_limit() -> None:
    """Leave room for NumPy/Pandas mappings, then cap analysis allocations."""
    try:
        with open('/proc/self/statm', encoding='ascii') as statm:
            virtual_pages = int(statm.readline().split()[0])
        current_virtual_bytes = virtual_pages * os.sysconf('SC_PAGE_SIZE')
    except (FileNotFoundError, OSError, ValueError, IndexError):
        current_virtual_bytes = 0
    limit = current_virtual_bytes + MEMORY_LIMIT_BYTES
    _, hard_limit = resource.getrlimit(resource.RLIMIT_AS)
    if hard_limit != resource.RLIM_INFINITY:
        limit = min(limit, hard_limit)
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))


def _child(code: str, dataset: dict[str, Any], cpu_seconds: int, conn) -> None:
    try:
        _apply_limits(cpu_seconds)
        import numpy as np
        import pandas as pd

        df = pd.DataFrame(dataset["rows"], columns=dataset["columns"])
        # Scientific libraries may create worker threads during import or frame
        # construction. Block new processes only once that setup is complete.
        _apply_limits(cpu_seconds, block_process_creation=True)
        _apply_memory_limit()
        safe_builtins = {
            k: __builtins__[k] if isinstance(__builtins__, dict) else getattr(__builtins__, k)
            for k in ("len", "range", "sum", "min", "max", "abs", "round", "sorted",
                      "list", "dict", "set", "tuple", "str", "int", "float", "bool",
                      "enumerate", "zip", "print", "isinstance", "True", "False", "None")
            if _has_builtin(k)
        }
        env: dict[str, Any] = {"__builtins__": safe_builtins, "pd": pd, "np": np, "df": df}

        buffer, original = StringIO(), sys.stdout
        sys.stdout = buffer
        try:
            # Deliberate: the code has passed AST validation and runs with a
            # reduced builtins mapping, rlimits and no environment. There is no
            # user-supplied string concatenated into it.
            exec(compile(code, "<analysis>", "exec"), env)  # noqa: S102
        finally:
            sys.stdout = original

        conn.send({
            "success": True,
            "stdout": buffer.getvalue()[:MAX_STDOUT_CHARS],
            "stderr": "",
            "result": _serialise(env.get("result"), pd),
        })
    except Exception as exc:  # noqa: BLE001 - reported to the caller, not raised
        conn.send({"success": False, "stdout": "", "stderr": f"{type(exc).__name__}: {exc}", "result": None})
    finally:
        conn.close()


def _has_builtin(name: str) -> bool:
    return hasattr(__builtins__, name) or (isinstance(__builtins__, dict) and name in __builtins__)


def _serialise(result: Any, pd) -> dict[str, Any] | None:
    if result is None:
        return None
    if isinstance(result, pd.Series):
        result = result.to_frame()
    if isinstance(result, pd.DataFrame):
        truncated = len(result) > MAX_OUTPUT_ROWS
        frame = result.head(MAX_OUTPUT_ROWS)
        return {
            "columns": [str(c) for c in frame.columns],
            "rows": frame.astype(object).where(frame.notna(), None).to_dict(orient="records"),
            "row_count": int(len(frame)),
            "truncated": truncated,
            "execution_time_ms": 0,
            "warnings": ["Output was truncated to the row limit."] if truncated else [],
        }
    return {
        "columns": ["value"], "rows": [{"value": str(result)[:1000]}],
        "row_count": 1, "truncated": False, "execution_time_ms": 0, "warnings": [],
    }


def run_analysis(code: str, dataset: dict[str, Any], timeout_ms: int = 15_000) -> dict[str, Any]:
    validation = validate_code(code)
    if not validation.valid:
        return {"success": False, "stdout": "", "stderr": "; ".join(validation.errors),
                "result": None, "execution_time_ms": 0, "warnings": validation.warnings}

    started = time.time()
    ctx = mp.get_context("fork")
    parent, child = ctx.Pipe(duplex=False)
    cpu_seconds = max(1, int(timeout_ms / 1000) + 1)
    proc = ctx.Process(target=_child, args=(code, dataset, cpu_seconds, child))
    proc.start()
    child.close()

    payload: dict[str, Any] | None = None
    if parent.poll(timeout_ms / 1000):
        try:
            payload = parent.recv()
        except EOFError:
            payload = None
    proc.join(timeout=1)
    if proc.is_alive():
        proc.terminate()
        proc.join(timeout=1)
        if proc.is_alive():
            proc.kill()
        return {"success": False, "stdout": "", "stderr": f"Execution exceeded the {timeout_ms} ms limit and was terminated.",
                "result": None, "execution_time_ms": timeout_ms, "warnings": []}

    elapsed = int((time.time() - started) * 1000)
    if payload is None:
        return {"success": False, "stdout": "", "stderr": "The analysis process exited without returning a result (it may have hit the memory limit).",
                "result": None, "execution_time_ms": elapsed, "warnings": []}
    payload["execution_time_ms"] = elapsed
    payload.setdefault("warnings", validation.warnings)
    if payload.get("result"):
        payload["result"]["execution_time_ms"] = elapsed
    return payload
