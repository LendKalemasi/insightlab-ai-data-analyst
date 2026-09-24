"""FastAPI wrapper around the restricted analysis runner."""
from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, Field

from runner import run_analysis
from validator import validate_code

app = FastAPI(title="InsightLab Analysis Service", version="0.1.0")


class Dataset(BaseModel):
    columns: list[str] = Field(max_length=500)
    rows: list[dict] = Field(max_length=200_000)


class ExecuteRequest(BaseModel):
    code: str = Field(max_length=8000)
    dataset: Dataset
    timeout_ms: int = Field(default=15_000, ge=100, le=60_000)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/validate")
def validate(body: ExecuteRequest) -> dict:
    v = validate_code(body.code)
    return {"valid": v.valid, "errors": v.errors, "warnings": v.warnings}


@app.post("/execute")
def execute(body: ExecuteRequest) -> dict:
    return run_analysis(body.code, body.dataset.model_dump(), body.timeout_ms)
