import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from src.main import app as main_app


def test_global_error_handler_hides_details_when_not_debug(monkeypatch):
    # Temporarily set debug to False
    monkeypatch.setattr(main_app.state.settings, "debug", False, raising=False)

    # Add a temporary failing route
    route_path = "/_boom"

    @main_app.get(route_path)
    async def _boom():
        raise RuntimeError("boom-details")

    client = TestClient(main_app)
    resp = client.get(route_path)

    assert resp.status_code == 500
    data = resp.json()
    assert data["error"] == "Internal server error"
    assert "detail" not in data  # no leakage in non-debug

    # Restore debug to True for other tests
    monkeypatch.setattr(main_app.state.settings, "debug", True, raising=False)

