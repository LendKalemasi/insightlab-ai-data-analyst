import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from runner import run_analysis

DATA = {
    "columns": ["region", "revenue"],
    "rows": [
        {"region": "North", "revenue": 100.0},
        {"region": "North", "revenue": 50.0},
        {"region": "South", "revenue": 30.0},
    ],
}


def test_executes_real_pandas_aggregation():
    out = run_analysis(
        "result = (df.groupby('region', as_index=False)['revenue'].sum()"
        ".sort_values('revenue', ascending=False))", DATA)
    assert out["success"], out["stderr"]
    rows = out["result"]["rows"]
    assert rows[0]["region"] == "North" and rows[0]["revenue"] == 150.0
    assert rows[1]["revenue"] == 30.0


def test_blocked_code_never_executes():
    out = run_analysis("import os\nresult = os.environ", DATA)
    assert not out["success"] and "os" in out["stderr"]


def test_timeout_is_enforced():
    out = run_analysis("x = 0\nwhile True:\n    x += 1", DATA, timeout_ms=1200)
    assert not out["success"] and "limit" in out["stderr"].lower()


def test_runtime_error_is_reported_not_raised():
    out = run_analysis("result = df['does_not_exist'].sum()", DATA)
    assert not out["success"] and "KeyError" in out["stderr"]


def test_output_rows_are_capped():
    big = {"columns": ["n"], "rows": [{"n": i} for i in range(2000)]}
    out = run_analysis("result = df", big)
    assert out["success"] and out["result"]["row_count"] == 1000 and out["result"]["truncated"]


def test_stdout_is_captured():
    out = run_analysis("print('hello')\nresult = df.head(1)", DATA)
    assert out["success"] and "hello" in out["stdout"]
