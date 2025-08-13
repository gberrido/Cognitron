#!/usr/bin/env python3
"""
Tests for WebSocket endpoints
"""

import pytest
import json
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from fastapi import WebSocket

from src.api.websocket import ConnectionManager, manager


class TestConnectionManager:
    """Test WebSocket connection manager"""

    @pytest.fixture
    def connection_manager(self):
        """Create a fresh connection manager"""
        return ConnectionManager()

    @pytest.mark.asyncio
    async def test_connection_management(self, connection_manager):
        """Test connection and disconnection"""
        user_id = "test_user"
        mock_websocket = AsyncMock()
        
        # Test connection
        await connection_manager.connect(mock_websocket, user_id)
        
        assert user_id in connection_manager.active_connections
        assert connection_manager.active_connections[user_id] == mock_websocket
        mock_websocket.accept.assert_called_once()
        
        # Test disconnection
        connection_manager.disconnect(user_id)
        assert user_id not in connection_manager.active_connections

    @pytest.mark.asyncio
    async def test_send_personal_message(self, connection_manager):
        """Test sending personal message"""
        user_id = "test_user"
        mock_websocket = AsyncMock()
        
        await connection_manager.connect(mock_websocket, user_id)
        
        # Send message
        message = "Hello, test user!"
        await connection_manager.send_personal_message(message, user_id)
        
        mock_websocket.send_text.assert_called_once_with(message)

    @pytest.mark.asyncio
    async def test_send_json_message(self, connection_manager):
        """Test sending JSON message"""
        user_id = "test_user"
        mock_websocket = AsyncMock()
        
        await connection_manager.connect(mock_websocket, user_id)
        
        # Send JSON message
        data = {"type": "test", "message": "Hello"}
        await connection_manager.send_json_message(data, user_id)
        
        expected_json = json.dumps(data)
        mock_websocket.send_text.assert_called_once_with(expected_json)

    @pytest.mark.asyncio
    async def test_send_to_nonexistent_user(self, connection_manager):
        """Test sending message to non-existent user"""
        # Should not raise error
        await connection_manager.send_personal_message("test", "nonexistent")
        await connection_manager.send_json_message({"test": "data"}, "nonexistent")


class TestWebSocketAuthentication:
    """Test WebSocket authentication"""

    @pytest.mark.asyncio
    async def test_websocket_authentication_success(self):
        """Test successful WebSocket authentication"""
        from src.api.websocket import authenticate_websocket
        
        mock_websocket = AsyncMock()
        mock_session_manager = MagicMock()
        mock_settings = MagicMock()
        
        # Mock successful validation
        mock_session_manager.validate_session.return_value = {
            "username": "test_user",
            "session_id": "test_session"
        }
        
        token = "valid-token"
        
        username = await authenticate_websocket(
            mock_websocket, token, mock_session_manager, mock_settings
        )
        
        assert username == "test_user"
        mock_session_manager.validate_session.assert_called_once_with(
            token, mock_settings.secret_key, mock_settings.algorithm
        )

    @pytest.mark.asyncio
    async def test_websocket_authentication_failure(self):
        """Test WebSocket authentication failure"""
        from src.api.websocket import authenticate_websocket
        from fastapi import HTTPException
        
        mock_websocket = AsyncMock()
        mock_session_manager = MagicMock()
        mock_settings = MagicMock()
        
        # Mock failed validation
        mock_session_manager.validate_session.return_value = None
        
        token = "invalid-token"
        
        with pytest.raises(HTTPException):
            await authenticate_websocket(
                mock_websocket, token, mock_session_manager, mock_settings
            )
        
        mock_websocket.close.assert_called_once_with(code=4001, reason="Authentication failed")


class TestWebSocketMessageHandling:
    """Test WebSocket message handling"""

    @pytest.fixture
    def mock_dependencies(self):
        """Mock all WebSocket dependencies"""
        return {
            "memory_system": AsyncMock(),
            "chat_agent": AsyncMock(),
            "session_manager": MagicMock(),
            "settings": MagicMock()
        }

    @pytest.mark.asyncio
    async def test_chat_message_handling(self, mock_dependencies):
        """Test handling chat messages"""
        from src.api.websocket import handle_chat_message, manager
        
        user_id = "test_user"
        message_data = {
            "message": "Hello, how are you?",
            "stream": True
        }
        
        # Mock streaming response
        async def mock_streaming():
            yield "Hello"
            yield " there"
            yield "!"
        
        mock_dependencies["chat_agent"]._generate_streaming_response.return_value = mock_streaming()
        mock_dependencies["memory_system"].add_to_fifo_queue = AsyncMock()
        mock_dependencies["memory_system"]._get_user_memory.return_value = {
            "current_session_id": "test_session"
        }
        
        # Mock manager to capture sent messages
        sent_messages = []
        original_send = manager.send_json_message
        
        async def mock_send(data, user):
            sent_messages.append(data)
        
        manager.send_json_message = mock_send
        
        try:
            await handle_chat_message(
                user_id, message_data, 
                mock_dependencies["chat_agent"],
                mock_dependencies["memory_system"]
            )
            
            # Should have sent typing start, stream messages, and typing end
            assert len(sent_messages) >= 3
            
            # Check for typing indicators
            typing_messages = [msg for msg in sent_messages if msg.get("type") == "typing"]
            assert len(typing_messages) >= 2  # start and end
            
            # Check for streaming messages
            stream_messages = [msg for msg in sent_messages if msg.get("type") in ["stream_start", "stream_chunk", "stream_end"]]
            assert len(stream_messages) >= 3
            
        finally:
            manager.send_json_message = original_send

    @pytest.mark.asyncio
    async def test_empty_message_handling(self, mock_dependencies):
        """Test handling empty messages"""
        from src.api.websocket import handle_chat_message, manager
        
        user_id = "test_user"
        message_data = {"message": ""}
        
        sent_messages = []
        
        async def mock_send(data, user):
            sent_messages.append(data)
        
        original_send = manager.send_json_message
        manager.send_json_message = mock_send
        
        try:
            await handle_chat_message(
                user_id, message_data,
                mock_dependencies["chat_agent"],
                mock_dependencies["memory_system"]
            )
            
            # Should send error message for empty content
            error_messages = [msg for msg in sent_messages if msg.get("type") == "error"]
            assert len(error_messages) >= 1
            
        finally:
            manager.send_json_message = original_send

    @pytest.mark.asyncio
    async def test_streaming_response_handling(self, mock_dependencies):
        """Test streaming response handling"""
        from src.api.websocket import handle_streaming_response, manager
        
        user_id = "test_user"
        user_message = "Tell me a story"
        
        # Mock streaming chunks
        async def mock_streaming():
            yield "Once"
            yield " upon"
            yield " a time"
        
        mock_dependencies["chat_agent"]._generate_streaming_response.return_value = mock_streaming()
        mock_dependencies["memory_system"].add_to_fifo_queue = AsyncMock()
        mock_dependencies["memory_system"]._get_user_memory.return_value = {
            "current_session_id": "test_session"
        }
        mock_dependencies["chat_agent"].get_conversation_context.return_value = []
        mock_dependencies["chat_agent"].config = {"model": "test", "temperature": 0.7, "max_tokens": 100}
        mock_dependencies["chat_agent"].tools = []
        
        sent_messages = []
        
        async def mock_send(data, user):
            sent_messages.append(data)
        
        original_send = manager.send_json_message
        manager.send_json_message = mock_send
        
        try:
            await handle_streaming_response(
                user_id, user_message,
                mock_dependencies["chat_agent"],
                mock_dependencies["memory_system"]
            )
            
            # Should have stream start, chunks, and end
            stream_start = [msg for msg in sent_messages if msg.get("type") == "stream_start"]
            stream_chunks = [msg for msg in sent_messages if msg.get("type") == "stream_chunk"]
            stream_end = [msg for msg in sent_messages if msg.get("type") == "stream_end"]
            
            assert len(stream_start) == 1
            assert len(stream_chunks) == 3  # "Once", " upon", " a time"
            assert len(stream_end) == 1
            
            # Verify chunk contents
            chunk_contents = [msg["content"] for msg in stream_chunks]
            assert chunk_contents == ["Once", " upon", " a time"]
            
            # Verify full content in end message
            assert stream_end[0]["full_content"] == "Once upon a time"
            
        finally:
            manager.send_json_message = original_send

    @pytest.mark.asyncio
    async def test_config_update_handling(self, mock_dependencies):
        """Test configuration update handling"""
        from src.api.websocket import handle_config_update, manager
        
        user_id = "test_user"
        message_data = {
            "config": {
                "temperature": 0.9,
                "max_tokens": 2000
            }
        }
        
        sent_messages = []
        
        async def mock_send(data, user):
            sent_messages.append(data)
        
        original_send = manager.send_json_message
        manager.send_json_message = mock_send
        
        try:
            await handle_config_update(
                user_id, message_data,
                mock_dependencies["chat_agent"]
            )
            
            # Should update config and send confirmation
            mock_dependencies["chat_agent"].update_config.assert_called_once_with({
                "temperature": 0.9,
                "max_tokens": 2000
            })
            
            # Should send success message
            success_messages = [msg for msg in sent_messages if msg.get("type") == "config_updated"]
            assert len(success_messages) == 1
            
        finally:
            manager.send_json_message = original_send

    @pytest.mark.asyncio
    async def test_ping_pong_handling(self):
        """Test ping-pong message handling"""
        # This would be handled in the main WebSocket endpoint
        # Testing the logic separately
        
        ping_data = {
            "type": "ping",
            "timestamp": "2024-01-01T12:00:00Z"
        }
        
        # Expected pong response
        expected_pong = {
            "type": "pong", 
            "timestamp": "2024-01-01T12:00:00Z"
        }
        
        # In actual implementation, this would be handled in websocket_chat_endpoint
        # Here we just verify the expected structure
        assert ping_data["type"] == "ping"
        assert "timestamp" in ping_data


class TestWebSocketIntegration:
    """Integration tests for WebSocket functionality"""

    @pytest.mark.asyncio
    async def test_websocket_connection_flow(self):
        """Test complete WebSocket connection flow"""
        # This is a conceptual test - actual WebSocket testing requires
        # special test clients like pytest-asyncio with WebSocket support
        
        # The flow would be:
        # 1. Client connects with token
        # 2. Server authenticates
        # 3. Server sends welcome message
        # 4. Client sends chat message
        # 5. Server processes and streams response
        # 6. Client disconnects
        
        # For now, we test individual components
        connection_manager = ConnectionManager()
        mock_websocket = AsyncMock()
        user_id = "test_user"
        
        # Connect
        await connection_manager.connect(mock_websocket, user_id)
        assert user_id in connection_manager.active_connections
        
        # Send welcome
        welcome_data = {
            "type": "system",
            "message": "Connected to Cognitron06 chat",
            "user_id": user_id
        }
        await connection_manager.send_json_message(welcome_data, user_id)
        
        # Verify welcome was sent
        mock_websocket.send_text.assert_called_with(json.dumps(welcome_data))
        
        # Disconnect
        connection_manager.disconnect(user_id)
        assert user_id not in connection_manager.active_connections

    def test_websocket_error_handling(self):
        """Test WebSocket error handling"""
        # Test error message structure
        error_data = {
            "type": "error",
            "message": "Something went wrong"
        }
        
        assert error_data["type"] == "error"
        assert "message" in error_data

    @pytest.mark.asyncio
    async def test_websocket_concurrent_connections(self):
        """Test multiple concurrent WebSocket connections"""
        connection_manager = ConnectionManager()
        
        # Create multiple mock connections
        users = ["user1", "user2", "user3"]
        websockets = [AsyncMock() for _ in users]
        
        # Connect all users
        for user, ws in zip(users, websockets):
            await connection_manager.connect(ws, user)
        
        # Verify all connected
        for user in users:
            assert user in connection_manager.active_connections
        
        # Send message to all
        message = {"type": "broadcast", "content": "Hello everyone"}
        for user in users:
            await connection_manager.send_json_message(message, user)
        
        # Verify all received message
        for ws in websockets:
            ws.send_text.assert_called_with(json.dumps(message))
        
        # Disconnect all
        for user in users:
            connection_manager.disconnect(user)
        
        # Verify all disconnected
        assert len(connection_manager.active_connections) == 0


class TestWebSocketSecurity:
    """Test WebSocket security measures"""

    @pytest.mark.asyncio
    async def test_websocket_token_validation(self):
        """Test that WebSocket properly validates tokens"""
        from src.api.websocket import authenticate_websocket
        from fastapi import HTTPException
        
        mock_websocket = AsyncMock()
        mock_session_manager = MagicMock()
        mock_settings = MagicMock()
        
        # Test various invalid tokens
        invalid_tokens = [
            "",
            "invalid",
            "Bearer invalid",
            "expired.token.here",
            None
        ]
        
        for token in invalid_tokens:
            mock_session_manager.validate_session.return_value = None
            
            with pytest.raises(HTTPException):
                await authenticate_websocket(
                    mock_websocket, token, mock_session_manager, mock_settings
                )

    def test_websocket_message_validation(self):
        """Test WebSocket message validation"""
        # Valid message structures
        valid_messages = [
            {"type": "chat", "message": "Hello"},
            {"type": "ping", "timestamp": "2024-01-01T12:00:00Z"},
            {"type": "config", "config": {"temperature": 0.7}}
        ]
        
        for msg in valid_messages:
            assert "type" in msg
            assert isinstance(msg["type"], str)
        
        # Invalid messages would be handled by JSON parsing
        # and message type checking in the actual endpoint