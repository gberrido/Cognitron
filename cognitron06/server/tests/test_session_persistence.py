import os
from src.services.storage import FileSessionStorage
from src.services.session_manager import SessionManager


def test_session_persists_across_instances(tmp_path):
    store_dir = tmp_path / "store"
    secret = "test-secret-123"

    storage = FileSessionStorage(store_dir)
    mgr1 = SessionManager(storage=storage)

    # Add a user and create a session
    hpw = mgr1.get_password_hash("pass123")
    mgr1.add_user("alice", hpw)
    session = mgr1.create_session("alice", secret_key=secret)

    token = session["access_token"]
    sess_id = session["session_id"]

    # Validate in first manager
    info1 = mgr1.validate_session(token, secret_key=secret)
    assert info1 and info1["username"] == "alice"

    # Simulate restart: new manager loads storage
    mgr2 = SessionManager(storage=FileSessionStorage(store_dir))
    info2 = mgr2.validate_session(token, secret_key=secret)
    assert info2 and info2["username"] == "alice"

    # End session in mgr2 and ensure persistence
    assert mgr2.end_session(sess_id) is True
    mgr3 = SessionManager(storage=FileSessionStorage(store_dir))
    # Token should no longer validate due to inactive session
    assert mgr3.validate_session(token, secret_key=secret) is None

