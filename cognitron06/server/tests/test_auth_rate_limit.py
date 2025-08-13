import time
from httpx import AsyncClient

from src.main import app


def test_rate_limit_blocks_after_failures(test_client, session_manager, test_user_credentials):
    username = test_user_credentials["username"]
    # Ensure user exists with known password
    hpw = session_manager.get_password_hash(test_user_credentials["password"])
    session_manager.users_db[username] = {"username": username, "hashed_password": hpw, "is_active": True}

    # Fail several times
    for _ in range(5):
        resp = test_client.post("/api/v1/auth/login", json={"username": username, "password": "wrong"})
        assert resp.status_code == 401

    # Now even correct password should be blocked temporarily
    resp_ok = test_client.post("/api/v1/auth/login", json={"username": username, "password": test_user_credentials["password"]})
    assert resp_ok.status_code == 401

    # Manually clear block for test by rewinding block window
    if username in session_manager.failed_attempts:
        session_manager.failed_attempts[username]["blocked_until"] = None

    # Now correct password should work
    resp_ok2 = test_client.post("/api/v1/auth/login", json={"username": username, "password": test_user_credentials["password"]})
    assert resp_ok2.status_code == 200

