import json
import pytest
from fastapi.testclient import TestClient

from src.main import app
from src.core.chat_agent import ChatAgent


@pytest.mark.asyncio
async def test_websocket_streaming_parity(authenticated_user, monkeypatch):
    token = authenticated_user["token"]

    # Stub streaming generator to produce deterministic chunks
    async def fake_stream(self, user_id: str, api_params: dict):
        yield {"type": "content_chunk", "content": "foo"}
        yield {"type": "content_chunk", "content": "bar"}
        yield {"type": "completion", "content": "foobar"}

    monkeypatch.setattr(ChatAgent, "_generate_streaming_response", fake_stream, raising=False)

    client = TestClient(app)
    with client.websocket_connect(f"/api/v1/ws/chat?token={token}") as ws:
        # Expect initial system message
        initial = ws.receive_text()
        payload = json.loads(initial)
        assert payload["type"] == "system"

        # Send a chat message
        ws.send_text(json.dumps({"type": "chat", "message": "hi", "stream": True}))

        seen_start = False
        seen_chunks = []
        seen_end = False
        # Read a few frames
        for _ in range(10):
            data = json.loads(ws.receive_text())
            if data.get("type") == "stream_start":
                seen_start = True
            elif data.get("type") == "stream_chunk":
                seen_chunks.append(data.get("content"))
            elif data.get("type") == "stream_end":
                seen_end = True
                break

        assert seen_start
        assert seen_chunks == ["foo", "bar"]
        assert seen_end

