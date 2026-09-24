import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from validator import validate_code


def test_allows_pandas_analysis():
    v = validate_code("result = df.groupby('region', as_index=False)['revenue'].sum()")
    assert v.valid and not v.errors


def test_allows_allowlisted_import():
    assert validate_code("import numpy as np\nresult = np.array([1, 2]).sum()").valid


def test_rejects_os():
    v = validate_code("import os\nresult = os.environ")
    assert not v.valid and any("os" in e for e in v.errors)


def test_rejects_subprocess():
    assert not validate_code("import subprocess\nsubprocess.run(['ls'])").valid


def test_rejects_socket_and_requests():
    assert not validate_code("import socket").valid
    assert not validate_code("import requests").valid


def test_rejects_from_import():
    assert not validate_code("from os import environ").valid


def test_rejects_eval_exec_open():
    for src in ("eval('1+1')", "exec('x=1')", "open('/etc/passwd')", "__import__('os')"):
        assert not validate_code(src).valid, src


def test_rejects_dunder_escape():
    assert not validate_code("result = ().__class__.__bases__[0].__subclasses__()").valid


def test_rejects_env_access_via_getattr():
    assert not validate_code("getattr(df, 'to_csv')('/tmp/x')").valid


def test_rejects_syntax_error():
    v = validate_code("result = (")
    assert not v.valid and "syntax error" in v.errors[0].lower()


def test_rejects_oversized_code():
    assert not validate_code("x = 1\n" * 3000).valid


def test_warns_when_no_result():
    v = validate_code("total = df['revenue'].sum()")
    assert v.valid and v.warnings
