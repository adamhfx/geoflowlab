import os

import pytest

jobs = pytest.importorskip("worker.jobs")


class _Cursor:
    rowcount = 1
    def fetchone(self):
        from datetime import datetime, timezone, timedelta
        return ("running", "token", datetime.now(timezone.utc) + timedelta(minutes=5))


class _Tx:
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False


class _Conn:
    def __init__(self):
        self.sql = []
    def transaction(self):
        return _Tx()
    def execute(self, sql, params=None):
        self.sql.append((sql, params))
        return _Cursor()


def test_storage_auth_does_not_send_secret_key_as_bearer(monkeypatch):
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test")
    assert jobs._storage_headers() == {"apikey": "sb_secret_test"}
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "eyJlegacy")
    assert jobs._storage_headers()["Authorization"] == "Bearer eyJlegacy"


def test_fenced_publish_writes_result_and_requires_current_token():
    conn = _Conn()
    job = {"run_id": "run", "job_id": "job", "lease_token": "token"}
    result = {"metrics": {"contractorNpv10": 123}}
    assert jobs._fenced(conn, job, "succeeded", export_path="u/r/token.xlsx", result=result)
    sql, params = conn.sql[1]
    assert "lease_token=%s" in sql and "lease_until > now()" in sql
    assert params[3] == '{"metrics": {"contractorNpv10": 123}}'
