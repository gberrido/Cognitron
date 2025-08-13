#!/usr/bin/env python3
"""
Integration tests for API endpoints
"""

import pytest
import json
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient
from httpx import AsyncClient

from src.main import app


class TestHealthEndpoints:
    """Test health and status endpoints"""

    def test_health_endpoint(self, test_client):
        """Test basic health check"""
        response = test_client.get("/api/v1/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "cognitron06-server"
        assert "timestamp" in data

    def test_system_status_endpoint(self, test_client):
        """Test system status endpoint"""
        response = test_client.get("/api/v1/status")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "operational"
        assert "services" in data
        assert "statistics" in data
        assert "version" in data

    def test_ping_endpoint(self, test_client):
        """Test ping endpoint"""
        response = test_client.get("/api/v1/ping")
        
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "pong"

    def test_root_endpoint(self, test_client):
        """Test root endpoint"""
        response = test_client.get("/")
        
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Cognitron06 Server"
        assert data["status"] == "running"


class TestAuthEndpoints:
    """Test authentication endpoints"""

    def test_login_success(self, test_client, test_user_credentials, session_manager):
        """Test successful login"""
        # Set up test user
        hashed_password = session_manager.get_password_hash(test_user_credentials["password"])
        session_manager.users_db[test_user_credentials["username"]] = {
            "username": test_user_credentials["username"],
            "hashed_password": hashed_password,
            "is_active": True
        }
        
        response = test_client.post(
            "/api/v1/auth/login",
            json=test_user_credentials
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert "expires_in" in data
        assert "session_id" in data

    def test_login_invalid_credentials(self, test_client):
        """Test login with invalid credentials"""
        response = test_client.post(
            "/api/v1/auth/login",
            json={"username": "invalid", "password": "wrong"}
        )
        
        assert response.status_code == 401
        data = response.json()
        assert "detail" in data

    def test_login_missing_fields(self, test_client):
        """Test login with missing fields"""
        response = test_client.post(
            "/api/v1/auth/login",
            json={"username": "test"}  # Missing password
        )
        
        assert response.status_code == 422

    def test_get_user_info(self, test_client, auth_headers):
        """Test get current user info"""
        response = test_client.get(
            "/api/v1/auth/me",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "username" in data
        assert "session_id" in data
        assert "is_active" in data

    def test_get_user_info_unauthorized(self, test_client):
        """Test get user info without authorization"""
        response = test_client.get("/api/v1/auth/me")
        
        assert response.status_code == 403  # FastAPI returns 403 for missing auth

    def test_logout(self, test_client, auth_headers):
        """Test logout"""
        response = test_client.post(
            "/api/v1/auth/logout",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "session_id" in data

    def test_refresh_token(self, test_client, auth_headers):
        """Test token refresh"""
        response = test_client.post(
            "/api/v1/auth/refresh",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "token_type" in data


class TestChatEndpoints:
    """Test chat endpoints"""

    def test_send_message(self, test_client, auth_headers):
        """Test sending a chat message"""
        response = test_client.post(
            "/api/v1/chat/message",
            headers=auth_headers,
            json={"message": "Hello, how are you?"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "content" in data
        assert "tool_calls" in data
        assert "session_id" in data
        assert isinstance(data["tool_calls"], list)

    def test_send_message_with_parameters(self, test_client, auth_headers):
        """Test sending message with custom parameters"""
        response = test_client.post(
            "/api/v1/chat/message",
            headers=auth_headers,
            json={
                "message": "Tell me about AI",
                "temperature": 0.5,
                "max_tokens": 1000
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "content" in data

    def test_send_empty_message(self, test_client, auth_headers):
        """Test sending empty message"""
        response = test_client.post(
            "/api/v1/chat/message",
            headers=auth_headers,
            json={"message": ""}
        )
        
        # Should still work but content might be limited
        assert response.status_code in [200, 422]

    def test_send_message_unauthorized(self, test_client):
        """Test sending message without authorization"""
        response = test_client.post(
            "/api/v1/chat/message",
            json={"message": "Hello"}
        )
        
        assert response.status_code == 401

    def test_get_chat_history(self, test_client, auth_headers):
        """Test getting chat history"""
        response = test_client.get(
            "/api/v1/chat/history",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "messages" in data
        assert "total_count" in data
        assert "session_id" in data
        assert isinstance(data["messages"], list)

    def test_get_chat_history_with_limit(self, test_client, auth_headers):
        """Test getting chat history with limit"""
        response = test_client.get(
            "/api/v1/chat/history?limit=10",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["messages"]) <= 10

    def test_clear_chat_history(self, test_client, auth_headers):
        """Test clearing chat history"""
        response = test_client.delete(
            "/api/v1/chat/history",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "message" in data


class TestMemoryEndpoints:
    """Test memory management endpoints"""

    def test_get_memory_status(self, test_client, auth_headers):
        """Test getting memory status"""
        response = test_client.get(
            "/api/v1/memory/status",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "session_id" in data
        assert "user_id" in data
        assert "working_context_size" in data
        assert "memory_pressure" in data

    def test_get_memory_pressure(self, test_client, auth_headers):
        """Test getting memory pressure info"""
        response = test_client.get(
            "/api/v1/memory/pressure",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "usage" in data
        assert "estimated_tokens" in data
        assert "warning" in data

    def test_get_working_context(self, test_client, auth_headers):
        """Test getting working context"""
        response = test_client.get(
            "/api/v1/memory/working-context",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_update_working_context(self, test_client, auth_headers):
        """Test updating working context"""
        response = test_client.post(
            "/api/v1/memory/working-context",
            headers=auth_headers,
            json={"key": "test_key", "value": "test_value"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "key" in data
        assert "value" in data

    def test_delete_working_context(self, test_client, auth_headers):
        """Test deleting working context entry"""
        # First create an entry
        test_client.post(
            "/api/v1/memory/working-context",
            headers=auth_headers,
            json={"key": "delete_test", "value": "test"}
        )
        
        # Then delete it
        response = test_client.delete(
            "/api/v1/memory/working-context/delete_test",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "message" in data

    def test_delete_nonexistent_context(self, test_client, auth_headers):
        """Test deleting non-existent working context entry"""
        response = test_client.delete(
            "/api/v1/memory/working-context/nonexistent",
            headers=auth_headers
        )
        
        assert response.status_code == 404

    def test_search_memory(self, test_client, auth_headers):
        """Test searching memory"""
        response = test_client.post(
            "/api/v1/memory/search",
            headers=auth_headers,
            json={"query": "test search", "max_results": 5}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "query" in data
        assert "results" in data
        assert "total_count" in data
        assert isinstance(data["results"], list)

    def test_search_memory_invalid_params(self, test_client, auth_headers):
        """Test memory search with invalid parameters"""
        response = test_client.post(
            "/api/v1/memory/search",
            headers=auth_headers,
            json={"max_results": 100}  # Missing query
        )
        
        assert response.status_code == 422

    def test_insert_archival_memory(self, test_client, auth_headers):
        """Test inserting archival memory"""
        response = test_client.post(
            "/api/v1/memory/archival",
            headers=auth_headers,
            json={
                "key": "test_archival",
                "data": "This is test archival data",
                "metadata": {"category": "test"}
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "key" in data

    def test_search_archival_memory(self, test_client, auth_headers):
        """Test searching archival memory"""
        response = test_client.post(
            "/api/v1/memory/archival/search",
            headers=auth_headers,
            json={"query": "archival", "max_results": 10}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "query" in data
        assert "results" in data
        assert "total_count" in data

    def test_list_sessions(self, test_client, auth_headers):
        """Test listing sessions"""
        response = test_client.get(
            "/api/v1/memory/sessions",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "sessions" in data
        assert "total_sessions" in data
        assert "current_session" in data


class TestErrorHandling:
    """Test error handling across endpoints"""

    def test_invalid_json(self, test_client, auth_headers):
        """Test invalid JSON handling"""
        response = test_client.post(
            "/api/v1/chat/message",
            headers={**auth_headers, "Content-Type": "application/json"},
            content="invalid json"
        )
        
        assert response.status_code == 422

    def test_missing_required_fields(self, test_client, auth_headers):
        """Test missing required fields"""
        response = test_client.post(
            "/api/v1/memory/working-context",
            headers=auth_headers,
            json={"key": "test"}  # Missing value
        )
        
        assert response.status_code == 422

    def test_invalid_auth_token(self, test_client):
        """Test invalid authentication token"""
        response = test_client.get(
            "/api/v1/memory/status",
            headers={"Authorization": "Bearer invalid-token"}
        )
        
        assert response.status_code == 401

    def test_expired_token_handling(self, test_client):
        """Test expired token handling"""
        # This would need a token with a past expiration time
        # For now, just test with malformed token
        response = test_client.get(
            "/api/v1/memory/status",
            headers={"Authorization": "Bearer expired.token.here"}
        )
        
        assert response.status_code == 401


@pytest.mark.asyncio
class TestAsyncEndpoints:
    """Test endpoints using async client"""

    async def test_concurrent_requests(self, async_client, auth_headers):
        """Test handling concurrent requests"""
        import asyncio
        
        # Create multiple concurrent requests
        tasks = [
            async_client.get("/api/v1/memory/status", headers=auth_headers),
            async_client.get("/api/v1/memory/working-context", headers=auth_headers),
            async_client.get("/api/v1/memory/sessions", headers=auth_headers)
        ]
        
        responses = await asyncio.gather(*tasks)
        
        # All requests should succeed
        for response in responses:
            assert response.status_code == 200

    async def test_async_chat_message(self, async_client, auth_headers):
        """Test async chat message"""
        response = await async_client.post(
            "/api/v1/chat/message",
            headers=auth_headers,
            json={"message": "Hello async world"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "content" in data


class TestValidationAndSecurity:
    """Test input validation and security measures"""

    def test_sql_injection_attempt(self, test_client, auth_headers):
        """Test SQL injection attempt (should be harmless with our file-based system)"""
        response = test_client.post(
            "/api/v1/memory/search",
            headers=auth_headers,
            json={"query": "'; DROP TABLE users; --", "max_results": 10}
        )
        
        # Should handle gracefully without errors
        assert response.status_code == 200

    def test_xss_attempt(self, test_client, auth_headers):
        """Test XSS attempt in message content"""
        response = test_client.post(
            "/api/v1/chat/message",
            headers=auth_headers,
            json={"message": "<script>alert('xss')</script>"}
        )
        
        # Should process without executing script
        assert response.status_code == 200

    def test_large_payload(self, test_client, auth_headers):
        """Test very large payload handling"""
        large_message = "x" * 10000  # 10KB message
        
        response = test_client.post(
            "/api/v1/chat/message",
            headers=auth_headers,
            json={"message": large_message}
        )
        
        # Should either accept or return appropriate error
        assert response.status_code in [200, 413, 422]

    def test_rate_limiting_simulation(self, test_client, auth_headers):
        """Test rapid requests (rate limiting would be handled by nginx in production)"""
        responses = []
        
        # Make multiple rapid requests
        for _ in range(5):
            response = test_client.get("/api/v1/health")
            responses.append(response)
        
        # All should succeed (no rate limiting in test environment)
        for response in responses:
            assert response.status_code == 200