import os
import shutil
import pytest

from server.src.core.memory_system import MemGPTMemorySystem


@pytest.fixture(scope="function")
def temp_data_dir(tmp_path):
    d = tmp_path / "memdata"
    d.mkdir()
    yield str(d)
    # Cleanup handled by tmp_path


def test_public_accessors_basic(temp_data_dir):
    ms = MemGPTMemorySystem({"data_dir": temp_data_dir})

    user_id = "test_user"

    # Access current session ID without prior state
    session_id = ms.get_current_session_id(user_id)
    assert isinstance(session_id, str) and session_id.startswith("session-")

    # Snapshot should reflect empty structures
    snap = ms.get_user_memory_snapshot(user_id)
    assert snap["current_session_id"] == session_id
    assert snap["working_context_size"] == 0
    assert snap["fifo_queue_length"] == 0
    assert snap["recall_storage_size"] == 0
    assert snap["archival_storage_size"] == 0

