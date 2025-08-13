import types
import asyncio
import pytest
from httpx import AsyncClient

from src.main import app
from src.core.chat_agent import ChatAgent


@pytest.mark.asyncio
async def test_streaming_sse_headers_and_chunks(async_client: AsyncClient, auth_headers, monkeypatch):
    # Patch ChatAgent._generate_streaming_response to yield predictable chunks
    async def fake_stream(self, user_id: str, api_params: dict):
        yield {"type": "content_chunk", "content": "Hello "}
        yield {"type": "content_chunk", "content": "World"}
        yield {"type": "completion", "content": "Hello World"}

    monkeypatch.setattr(ChatAgent, "_generate_streaming_response", fake_stream, raising=False)

    # Stream the response
    async with async_client.stream(
        "POST",
        "/api/v1/chat/stream",
        headers={**auth_headers, "Content-Type": "application/json"},
        json={"message": "test", "stream": True},
    ) as r:
        # Validate SSE headers
        ct = r.headers.get("content-type", "")
        assert ct.startswith("text/event-stream")

        # Read a couple of chunks to ensure we get data lines
        text_accum = ""
        async for chunk in r.aiter_text():
            text_accum += chunk
            if "data:" in text_accum:
                break

        assert "data:" in text_accum

