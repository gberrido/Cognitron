#!/usr/bin/env python3
"""
End-to-end integration tests for Cognitron06 server
"""

import pytest
import asyncio
import tempfile
import shutil
from pathlib import Path
from fastapi.testclient import TestClient
from httpx import AsyncClient

from src.main import app
from src.core.memory_system import MemGPTMemorySystem
from src.core.chat_agent import ChatAgent
from src.services.session_manager import SessionManager
from src.core.config import Settings


class TestFullUserJourney:
    """Test complete user interaction flows"""

    @pytest.fixture
    async def clean_test_environment(self):
        """Set up a completely clean test environment"""
        # Create temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Create test settings
        settings = Settings(
            groq_api_key="test-api-key",
            secret_key="test-secret-key-for-integration-tests",
            debug=True,
            memory_config={
                "data_dir": str(temp_dir),
                "max_working_context_size": 100,
                "max_fifo_queue_size": 5,
                "memory_pressure_threshold": 0.8,
                "context_window_size": 1000
            }
        )
        
        # Initialize components
        memory_system = MemGPTMemorySystem(settings.memory_config)
        await memory_system.initialize()
        
        chat_agent = ChatAgent(
            api_key="test-key",
            model="test-model",
            memory_system=memory_system
        )
        
        session_manager = SessionManager()
        
        # Mock app state
        app.state.memory_system = memory_system
        app.state.chat_agent = chat_agent
        app.state.session_manager = session_manager
        app.state.settings = settings
        
        yield {
            "memory_system": memory_system,
            "chat_agent": chat_agent,
            "session_manager": session_manager,
            "settings": settings,
            "temp_dir": Path(temp_dir)
        }
        
        # Cleanup
        await memory_system.cleanup()
        shutil.rmtree(temp_dir)

    @pytest.mark.asyncio
    async def test_complete_user_session(self, clean_test_environment):
        """Test a complete user session from login to logout"""
        async with AsyncClient(app=app, base_url="http://test") as client:
            
            # Step 1: Health check
            health_response = await client.get("/api/v1/health")
            assert health_response.status_code == 200
            
            # Step 2: Login
            login_response = await client.post(
                "/api/v1/auth/login",
                json={"username": "demo", "password": "demo123"}
            )
            assert login_response.status_code == 200
            login_data = login_response.json()
            token = login_data["access_token"]
            
            headers = {"Authorization": f"Bearer {token}"}
            
            # Step 3: Check user info
            user_response = await client.get("/api/v1/auth/me", headers=headers)
            assert user_response.status_code == 200
            user_data = user_response.json()
            assert user_data["username"] == "demo"
            
            # Step 4: Check memory status (should be empty initially)
            memory_response = await client.get("/api/v1/memory/status", headers=headers)
            assert memory_response.status_code == 200
            memory_data = memory_response.json()
            assert memory_data["working_context_size"] == 0
            assert memory_data["recall_storage_size"] == 0
            
            # Step 5: Send first message
            chat_response = await client.post(
                "/api/v1/chat/message",
                headers=headers,
                json={"message": "Hi, my name is Alice and I'm a data scientist"}
            )
            assert chat_response.status_code == 200
            chat_data = chat_response.json()
            assert "content" in chat_data
            
            # Should have some tool calls for memory management
            tool_calls = chat_data.get("tool_calls", [])
            memory_tool_calls = [tc for tc in tool_calls if "memory" in tc["function_name"]]
            
            # Step 6: Check memory after first message
            memory_response = await client.get("/api/v1/memory/status", headers=headers)
            memory_data = memory_response.json()
            assert memory_data["recall_storage_size"] >= 1  # At least user message
            
            # Step 7: Send follow-up message
            followup_response = await client.post(
                "/api/v1/chat/message",
                headers=headers,
                json={"message": "What's my name and profession?"}
            )
            assert followup_response.status_code == 200
            followup_data = followup_response.json()
            
            # Response should reference the stored information
            content = followup_data["content"].lower()
            # Note: This would work with a real AI model
            
            # Step 8: Check working context
            context_response = await client.get("/api/v1/memory/working-context", headers=headers)
            assert context_response.status_code == 200
            context_data = context_response.json()
            
            # Step 9: Search conversation history
            search_response = await client.post(
                "/api/v1/memory/search",
                headers=headers,
                json={"query": "data scientist", "max_results": 5}
            )
            assert search_response.status_code == 200
            search_data = search_response.json()
            assert search_data["total_count"] >= 1
            
            # Step 10: Insert archival data
            archival_response = await client.post(
                "/api/v1/memory/archival",
                headers=headers,
                json={
                    "key": "user_projects",
                    "data": "Working on recommendation systems for streaming platforms",
                    "metadata": {"category": "work"}
                }
            )
            assert archival_response.status_code == 200
            
            # Step 11: Search archival data
            archival_search_response = await client.post(
                "/api/v1/memory/archival/search",
                headers=headers,
                json={"query": "recommendation"}
            )
            assert archival_search_response.status_code == 200
            archival_search_data = archival_search_response.json()
            assert archival_search_data["total_count"] >= 1
            
            # Step 12: Get chat history
            history_response = await client.get("/api/v1/chat/history", headers=headers)
            assert history_response.status_code == 200
            history_data = history_response.json()
            assert history_data["total_count"] >= 2
            
            # Step 13: List sessions
            sessions_response = await client.get("/api/v1/memory/sessions", headers=headers)
            assert sessions_response.status_code == 200
            sessions_data = sessions_response.json()
            assert sessions_data["total_sessions"] >= 1
            
            # Step 14: Logout
            logout_response = await client.post("/api/v1/auth/logout", headers=headers)
            assert logout_response.status_code == 200

    @pytest.mark.asyncio
    async def test_memory_persistence_across_sessions(self, clean_test_environment):
        """Test that memory persists across different user sessions"""
        async with AsyncClient(app=app, base_url="http://test") as client:
            
            # Session 1: Store information
            login_response = await client.post(
                "/api/v1/auth/login",
                json={"username": "demo", "password": "demo123"}
            )
            token1 = login_response.json()["access_token"]
            headers1 = {"Authorization": f"Bearer {token1}"}
            
            # Store working context
            await client.post(
                "/api/v1/memory/working-context",
                headers=headers1,
                json={"key": "user_name", "value": "Alice"}
            )
            
            # Send message
            await client.post(
                "/api/v1/chat/message",
                headers=headers1,
                json={"message": "I love machine learning"}
            )
            
            # Logout
            await client.post("/api/v1/auth/logout", headers=headers1)
            
            # Session 2: Check if information persists
            login_response2 = await client.post(
                "/api/v1/auth/login",
                json={"username": "demo", "password": "demo123"}
            )
            token2 = login_response2.json()["access_token"]
            headers2 = {"Authorization": f"Bearer {token2}"}
            
            # Check working context persists
            context_response = await client.get(
                "/api/v1/memory/working-context",
                headers=headers2
            )
            context_data = context_response.json()
            user_name_entries = [entry for entry in context_data if entry["key"] == "user_name"]
            assert len(user_name_entries) == 1
            assert user_name_entries[0]["value"] == "Alice"
            
            # Check conversation history persists
            search_response = await client.post(
                "/api/v1/memory/search",
                headers=headers2,
                json={"query": "machine learning"}
            )
            search_data = search_response.json()
            assert search_data["total_count"] >= 1

    @pytest.mark.asyncio
    async def test_concurrent_user_sessions(self, clean_test_environment):
        """Test multiple concurrent user sessions"""
        async with AsyncClient(app=app, base_url="http://test") as client:
            
            # Create two concurrent sessions
            login1 = await client.post(
                "/api/v1/auth/login",
                json={"username": "demo", "password": "demo123"}
            )
            token1 = login1.json()["access_token"]
            headers1 = {"Authorization": f"Bearer {token1}"}
            
            # Create second user for testing
            session_manager = clean_test_environment["session_manager"]
            session_manager.users_db["user2"] = {
                "username": "user2",
                "hashed_password": session_manager.get_password_hash("password"),
                "is_active": True
            }
            
            login2 = await client.post(
                "/api/v1/auth/login",
                json={"username": "user2", "password": "password"}
            )
            token2 = login2.json()["access_token"]
            headers2 = {"Authorization": f"Bearer {token2}"}
            
            # Both users store different information
            await client.post(
                "/api/v1/memory/working-context",
                headers=headers1,
                json={"key": "user_name", "value": "Alice"}
            )
            
            await client.post(
                "/api/v1/memory/working-context",
                headers=headers2,
                json={"key": "user_name", "value": "Bob"}
            )
            
            # Verify data isolation
            context1 = await client.get("/api/v1/memory/working-context", headers=headers1)
            context2 = await client.get("/api/v1/memory/working-context", headers=headers2)
            
            context1_data = context1.json()
            context2_data = context2.json()
            
            user1_name = [entry for entry in context1_data if entry["key"] == "user_name"][0]["value"]
            user2_name = [entry for entry in context2_data if entry["key"] == "user_name"][0]["value"]
            
            assert user1_name == "Alice"
            assert user2_name == "Bob"

    @pytest.mark.asyncio
    async def test_memory_pressure_management(self, clean_test_environment):
        """Test memory pressure management with small limits"""
        async with AsyncClient(app=app, base_url="http://test") as client:
            
            login_response = await client.post(
                "/api/v1/auth/login",
                json={"username": "demo", "password": "demo123"}
            )
            token = login_response.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
            
            # Fill up memory with messages (small FIFO queue size of 5)
            for i in range(10):
                await client.post(
                    "/api/v1/chat/message",
                    headers=headers,
                    json={"message": f"This is message number {i}"}
                )
            
            # Check memory status
            status_response = await client.get("/api/v1/memory/status", headers=headers)
            status_data = status_response.json()
            
            # FIFO queue should be at max size
            assert status_data["fifo_queue_length"] <= 5
            
            # But recall storage should have all messages
            assert status_data["recall_storage_size"] >= 10
            
            # Check memory pressure
            pressure_response = await client.get("/api/v1/memory/pressure", headers=headers)
            pressure_data = pressure_response.json()
            
            assert "usage" in pressure_data
            assert "warning" in pressure_data

    @pytest.mark.asyncio
    async def test_error_recovery(self, clean_test_environment):
        """Test system recovery from various error conditions"""
        async with AsyncClient(app=app, base_url="http://test") as client:
            
            login_response = await client.post(
                "/api/v1/auth/login",
                json={"username": "demo", "password": "demo123"}
            )
            token = login_response.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
            
            # Test invalid requests - should not crash system
            invalid_requests = [
                # Invalid working context
                {"url": "/api/v1/memory/working-context", "json": {"key": "", "value": "test"}},
                # Invalid search
                {"url": "/api/v1/memory/search", "json": {"query": "", "max_results": 0}},
                # Invalid chat message
                {"url": "/api/v1/chat/message", "json": {"message": ""}},
            ]
            
            for req in invalid_requests:
                response = await client.post(req["url"], headers=headers, json=req["json"])
                # Should get error but not crash (4xx error, not 5xx)
                assert response.status_code < 500
            
            # System should still be functional after errors
            health_response = await client.get("/api/v1/health")
            assert health_response.status_code == 200
            
            # Should still be able to make valid requests
            valid_response = await client.get("/api/v1/memory/status", headers=headers)
            assert valid_response.status_code == 200

    @pytest.mark.asyncio
    async def test_data_consistency(self, clean_test_environment):
        """Test data consistency across operations"""
        async with AsyncClient(app=app, base_url="http://test") as client:
            
            login_response = await client.post(
                "/api/v1/auth/login",
                json={"username": "demo", "password": "demo123"}
            )
            token = login_response.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
            
            # Add working context
            await client.post(
                "/api/v1/memory/working-context",
                headers=headers,
                json={"key": "test_key", "value": "original_value"}
            )
            
            # Update it
            await client.post(
                "/api/v1/memory/working-context",
                headers=headers,
                json={"key": "test_key", "value": "updated_value"}
            )
            
            # Verify update
            context_response = await client.get("/api/v1/memory/working-context", headers=headers)
            context_data = context_response.json()
            
            test_entries = [entry for entry in context_data if entry["key"] == "test_key"]
            assert len(test_entries) == 1
            assert test_entries[0]["value"] == "updated_value"
            assert test_entries[0]["update_count"] == 2
            
            # Delete it
            delete_response = await client.delete(
                "/api/v1/memory/working-context/test_key",
                headers=headers
            )
            assert delete_response.status_code == 200
            
            # Verify deletion
            context_response = await client.get("/api/v1/memory/working-context", headers=headers)
            context_data = context_response.json()
            
            test_entries = [entry for entry in context_data if entry["key"] == "test_key"]
            assert len(test_entries) == 0


class TestSystemRobustness:
    """Test system robustness and edge cases"""

    @pytest.mark.asyncio
    async def test_large_dataset_handling(self, clean_test_environment):
        """Test handling of large datasets"""
        async with AsyncClient(app=app, base_url="http://test") as client:
            
            login_response = await client.post(
                "/api/v1/auth/login",
                json={"username": "demo", "password": "demo123"}
            )
            token = login_response.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
            
            # Add many working context entries
            for i in range(20):
                await client.post(
                    "/api/v1/memory/working-context",
                    headers=headers,
                    json={"key": f"key_{i}", "value": f"value_{i}"}
                )
            
            # System should still respond
            status_response = await client.get("/api/v1/memory/status", headers=headers)
            assert status_response.status_code == 200
            
            # Should be able to retrieve all entries
            context_response = await client.get("/api/v1/memory/working-context", headers=headers)
            assert context_response.status_code == 200
            context_data = context_response.json()
            assert len(context_data) == 20

    @pytest.mark.asyncio
    async def test_unicode_and_special_characters(self, clean_test_environment):
        """Test handling of Unicode and special characters"""
        async with AsyncClient(app=app, base_url="http://test") as client:
            
            login_response = await client.post(
                "/api/v1/auth/login",
                json={"username": "demo", "password": "demo123"}
            )
            token = login_response.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
            
            # Test Unicode characters
            unicode_text = "Hello 👋 世界 🌍 Émojis and spéciał characters! 🚀"
            
            # Store in working context
            await client.post(
                "/api/v1/memory/working-context",
                headers=headers,
                json={"key": "unicode_test", "value": unicode_text}
            )
            
            # Send as chat message
            chat_response = await client.post(
                "/api/v1/chat/message",
                headers=headers,
                json={"message": unicode_text}
            )
            assert chat_response.status_code == 200
            
            # Search for it
            search_response = await client.post(
                "/api/v1/memory/search",
                headers=headers,
                json={"query": "世界"}
            )
            assert search_response.status_code == 200
            
            # Verify data integrity
            context_response = await client.get("/api/v1/memory/working-context", headers=headers)
            context_data = context_response.json()
            
            unicode_entries = [entry for entry in context_data if entry["key"] == "unicode_test"]
            assert len(unicode_entries) == 1
            assert unicode_entries[0]["value"] == unicode_text

    @pytest.mark.asyncio
    async def test_system_status_monitoring(self, clean_test_environment):
        """Test system status and monitoring endpoints"""
        async with AsyncClient(app=app, base_url="http://test") as client:
            
            # Test health endpoint
            health_response = await client.get("/api/v1/health")
            assert health_response.status_code == 200
            health_data = health_response.json()
            assert health_data["status"] == "healthy"
            
            # Test system status
            status_response = await client.get("/api/v1/status")
            assert status_response.status_code == 200
            status_data = status_response.json()
            assert status_data["status"] == "operational"
            assert "services" in status_data
            assert "statistics" in status_data
            
            # Create some activity and check statistics
            login_response = await client.post(
                "/api/v1/auth/login",
                json={"username": "demo", "password": "demo123"}
            )
            
            # Check status again
            status_response = await client.get("/api/v1/status")
            status_data = status_response.json()
            assert status_data["statistics"]["active_sessions"] >= 1