"""Static validation of generated analysis code.

The AST is walked before anything is executed. Anything not on the allowlist is
rejected; this is a deny-by-default design, not a blocklist of known-bad names.
Static analysis alone is not a security boundary, so it is paired with the
process-level restrictions in runner.py and the container limits in
docker-compose.yml. See PORTFOLIO_STATUS.md for the honest threat model.
"""
from __future__ import annotations

import ast
from dataclasses import dataclass, field

ALLOWED_MODULES = {"pandas", "numpy", "math", "statistics", "datetime", "json"}
ALLOWED_CALLS = {
    "len", "range", "sum", "min", "max", "abs", "round", "sorted", "list",
    "dict", "set", "tuple", "str", "int", "float", "bool", "enumerate", "zip",
    "print", "isinstance",
}
BANNED_CALLS = {
    "eval", "exec", "compile", "open", "__import__", "getattr", "setattr",
    "delattr", "globals", "locals", "vars", "input", "exit", "quit", "breakpoint",
    "memoryview", "help",
}
MAX_CODE_LENGTH = 8000


@dataclass
class ValidationResult:
    valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def validate_code(code: str) -> ValidationResult:
    errors: list[str] = []
    warnings: list[str] = []

    if len(code) > MAX_CODE_LENGTH:
        return ValidationResult(False, [f"Code exceeds the {MAX_CODE_LENGTH} character limit."])

    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as exc:
        return ValidationResult(False, [f"Python syntax error on line {exc.lineno}: {exc.msg}."])

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root not in ALLOWED_MODULES:
                    errors.append(f"Import of '{alias.name}' is not allowed.")
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root not in ALLOWED_MODULES:
                errors.append(f"Import from '{node.module}' is not allowed.")
        elif isinstance(node, ast.Call):
            name = _call_name(node.func)
            if name in BANNED_CALLS:
                errors.append(f"Call to '{name}' is not allowed.")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__") and node.attr.endswith("__"):
                errors.append(f"Access to the dunder attribute '{node.attr}' is not allowed.")
        elif isinstance(node, ast.Name):
            if node.id.startswith("__") and node.id.endswith("__"):
                errors.append(f"Access to '{node.id}' is not allowed.")
        elif isinstance(node, (ast.AsyncFunctionDef, ast.Await, ast.AsyncFor, ast.AsyncWith)):
            errors.append("Asynchronous constructs are not allowed.")
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            errors.append("Global and nonlocal statements are not allowed.")

    if "result" not in code:
        warnings.append("The code does not assign a 'result' variable, so no table will be returned.")

    return ValidationResult(not errors, sorted(set(errors)), warnings)


def _call_name(func: ast.expr) -> str:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return ""
