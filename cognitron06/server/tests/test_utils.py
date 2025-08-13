#!/usr/bin/env python3
"""
Test utilities and helper functions
"""

import pytest
import asyncio
import json
import time
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from typing import Dict, List, Any

from src.core.memory_system import MemGPTMemorySystem, Message


class MemoryTestHelper:
    """Helper class for memory system testing"""
    
    @staticmethod
    async def populate_memory(memory_system: MemGPTMemorySystem, user_id: str, 
                             message_count: int = 5) -> List[str]:
        """Populate memory system with test messages"""
        message_ids = []
        
        for i in range(message_count):
            if i % 2 == 0:
                role = "user"
                content = f"User message {i}: This is about topic {i % 3}"
            else:
                role = "assistant"
                content = f"Assistant response {i}: I understand topic {i % 3}"
            
            message_id = await memory_system.add_to_fifo_queue(user_id, role, content)
            if message_id:
                message_ids.append(message_id)
        
        return message_ids
    
    @staticmethod
    async def populate_working_context(memory_system: MemGPTMemorySystem, user_id: str,
                                     entries: Dict[str, str] = None) -> Dict[str, str]:
        """Populate working context with test data"""
        if entries is None:
            entries = {
                "user_name": "Test User",
                "occupation": "Software Engineer",
                "interests": "AI, Machine Learning, Programming",
                "location": "San Francisco"
            }
        
        for key, value in entries.items():
            await memory_system.update_working_context(user_id, key, value)
        
        return entries
    
    @staticmethod
    async def populate_archival(memory_system: MemGPTMemorySystem, user_id: str,
                               entries: Dict[str, Any] = None) -> Dict[str, Any]:
        """Populate archival storage with test data"""
        if entries is None:
            entries = {
                "project_info": "Working on AI assistant with memory capabilities",
                "meeting_notes": "Discussed memory architecture and implementation details",
                "technical_specs": "Using MemGPT approach with hierarchical memory",
                "user_feedback": "Positive response to memory features"
            }
        
        for key, data in entries.items():
            await memory_system.insert_archival(user_id, key, str(data))
        
        return entries
    
    @staticmethod
    def verify_memory_structure(memory_system: MemGPTMemorySystem, user_id: str):
        """Verify memory structure is properly initialized"""
        memory = memory_system._get_user_memory(user_id)
        
        required_keys = [
            "working_context", "fifo_queue", "recursive_summary",
            "recall_storage", "archival_storage", "current_session_id"
        ]
        
        for key in required_keys:
            assert key in memory, f"Missing key: {key}"
        
        # Verify types
        assert isinstance(memory["working_context"], dict)
        assert isinstance(memory["fifo_queue"], list)
        assert isinstance(memory["recall_storage"], list)
        assert isinstance(memory["archival_storage"], dict)
        assert isinstance(memory["recursive_summary"], str)


class ChatAgentTestHelper:
    """Helper class for chat agent testing"""
    
    @staticmethod
    def create_mock_groq_response(content: str = "Test response", 
                                 tool_calls: List[Dict] = None,
                                 usage: Dict[str, int] = None) -> MagicMock:
        """Create a mock Groq API response"""
        if usage is None:
            usage = {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
        
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = content
        mock_response.choices[0].message.tool_calls = tool_calls or []
        mock_response.usage.prompt_tokens = usage["prompt_tokens"]
        mock_response.usage.completion_tokens = usage["completion_tokens"]
        mock_response.usage.total_tokens = usage["total_tokens"]
        
        return mock_response
    
    @staticmethod
    def create_mock_tool_call(function_name: str, arguments: Dict[str, Any]) -> MagicMock:
        """Create a mock tool call"""
        mock_tool_call = MagicMock()
        mock_tool_call.id = f"call-{int(time.time())}"
        mock_tool_call.function.name = function_name
        mock_tool_call.function.arguments = json.dumps(arguments)
        return mock_tool_call
    
    @staticmethod
    async def create_streaming_response(chunks: List[str]) -> AsyncMock:
        """Create a mock streaming response"""
        async def mock_stream():
            for chunk in chunks:
                mock_chunk = MagicMock()
                mock_chunk.choices = [MagicMock()]
                mock_chunk.choices[0].delta.content = chunk
                yield mock_chunk
        
        return mock_stream()


class AuthTestHelper:
    """Helper class for authentication testing"""
    
    @staticmethod
    def create_test_user(session_manager, username: str, password: str):
        """Create a test user in session manager"""
        hashed_password = session_manager.get_password_hash(password)
        session_manager.users_db[username] = {
            "username": username,
            "hashed_password": hashed_password,
            "created_at": datetime.now().isoformat(),
            "is_active": True
        }
        return username
    
    @staticmethod
    def create_expired_session(session_manager, username: str, secret_key: str):
        """Create an expired session for testing"""
        # Create normal session first
        session_data = session_manager.create_session(username, secret_key)
        
        # Manually expire it
        session_id = session_data["session_id"]
        past_time = datetime.now() - timedelta(hours=1)
        session_manager.active_sessions[session_id]["expires_at"] = past_time.isoformat()
        
        return session_data


class APITestHelper:
    """Helper class for API testing"""
    
    @staticmethod
    async def authenticate_test_user(client, username: str = "demo", 
                                   password: str = "demo123") -> Dict[str, str]:
        """Authenticate a test user and return headers"""
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": password}
        )
        
        if login_response.status_code != 200:
            raise Exception(f"Authentication failed: {login_response.text}")
        
        token = login_response.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}
    
    @staticmethod
    def validate_error_response(response, expected_status: int = None):
        """Validate error response format"""
        if expected_status:
            assert response.status_code == expected_status
        
        if response.status_code >= 400:
            data = response.json()
            # FastAPI error responses should have detail field
            assert "detail" in data or "error" in data
    
    @staticmethod
    def validate_success_response(response, required_fields: List[str] = None):
        """Validate successful response format"""
        assert response.status_code == 200
        
        if required_fields:
            data = response.json()
            for field in required_fields:
                assert field in data, f"Missing required field: {field}"


class WebSocketTestHelper:
    """Helper class for WebSocket testing"""
    
    @staticmethod
    async def simulate_websocket_message_flow(connection_manager, user_id: str,
                                            messages: List[Dict[str, Any]]):
        """Simulate a flow of WebSocket messages"""
        mock_websocket = AsyncMock()
        
        # Connect
        await connection_manager.connect(mock_websocket, user_id)
        
        # Send messages
        for message in messages:
            await connection_manager.send_json_message(message, user_id)
        
        # Verify messages were sent
        assert mock_websocket.send_text.call_count == len(messages)
        
        # Disconnect
        connection_manager.disconnect(user_id)
        
        return mock_websocket
    
    @staticmethod
    def create_websocket_message(message_type: str, **kwargs) -> Dict[str, Any]:
        """Create a WebSocket message with proper structure"""
        base_message = {"type": message_type, "timestamp": datetime.now().isoformat()}
        base_message.update(kwargs)
        return base_message


class DataGenerationHelper:
    """Helper class for generating test data"""
    
    @staticmethod
    def generate_conversation_messages(count: int = 10) -> List[Dict[str, str]]:
        """Generate a conversation of test messages"""
        messages = []
        topics = ["AI", "programming", "data science", "machine learning", "technology"]
        
        for i in range(count):
            if i % 2 == 0:
                role = "user"
                topic = topics[i % len(topics)]
                content = f"Can you tell me about {topic}? This is message {i}."
            else:
                role = "assistant"
                content = f"Certainly! Here's information about that topic. Response {i}."
            
            messages.append({"role": role, "content": content})
        
        return messages
    
    @staticmethod
    def generate_working_context_data(size: int = 5) -> Dict[str, str]:
        """Generate working context test data"""
        base_data = {
            "user_name": "Test User",
            "occupation": "Software Engineer",
            "location": "San Francisco",
            "interests": "AI and Machine Learning",
            "programming_languages": "Python, JavaScript",
        }
        
        # Add more data if needed
        for i in range(size - len(base_data)):
            base_data[f"extra_field_{i}"] = f"extra_value_{i}"
        
        return dict(list(base_data.items())[:size])
    
    @staticmethod
    def generate_large_text(size_kb: int = 1) -> str:
        """Generate large text for testing"""
        # Generate approximately size_kb kilobytes of text
        words = ["test", "data", "memory", "system", "artificial", "intelligence"]
        text_parts = []
        target_size = size_kb * 1024
        
        while len(" ".join(text_parts)) < target_size:
            text_parts.extend(words)
        
        return " ".join(text_parts)[:target_size]


class PerformanceTestHelper:
    """Helper class for performance testing"""
    
    @staticmethod
    async def measure_response_time(async_func, *args, **kwargs) -> tuple:
        """Measure response time of an async function"""
        start_time = time.time()
        result = await async_func(*args, **kwargs)
        end_time = time.time()
        
        return result, (end_time - start_time)
    
    @staticmethod
    async def run_concurrent_operations(operations: List, max_concurrent: int = 10):
        """Run multiple operations concurrently with limit"""
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def limited_operation(op):
            async with semaphore:
                return await op
        
        # Convert operations to coroutines if they aren't already
        coroutines = []
        for op in operations:
            if asyncio.iscoroutinefunction(op):
                coroutines.append(limited_operation(op()))
            elif asyncio.iscoroutine(op):
                coroutines.append(limited_operation(op))
            else:
                # Assume it's a callable that returns a coroutine
                coroutines.append(limited_operation(op))
        
        return await asyncio.gather(*coroutines)


class ValidationHelper:
    """Helper class for data validation"""
    
    @staticmethod
    def validate_message_structure(message: Dict[str, Any]):
        """Validate message structure"""
        required_fields = ["id", "timestamp", "session_id", "user_id", "role", "content"]
        
        for field in required_fields:
            assert field in message, f"Missing field: {field}"
        
        # Validate types
        assert isinstance(message["id"], str)
        assert isinstance(message["timestamp"], str)
        assert isinstance(message["role"], str)
        assert isinstance(message["content"], str)
        
        # Validate role
        assert message["role"] in ["user", "assistant", "system"]
        
        # Validate timestamp format (ISO 8601)
        datetime.fromisoformat(message["timestamp"])
    
    @staticmethod
    def validate_memory_status(status: Dict[str, Any]):
        """Validate memory status structure"""
        required_fields = [
            "session_id", "user_id", "working_context_size",
            "fifo_queue_length", "recall_storage_size",
            "archival_storage_size", "memory_pressure"
        ]
        
        for field in required_fields:
            assert field in status, f"Missing field: {field}"
        
        # Validate types and ranges
        assert isinstance(status["working_context_size"], int)
        assert status["working_context_size"] >= 0
        
        assert isinstance(status["memory_pressure"], (int, float))
        assert 0 <= status["memory_pressure"] <= 1
    
    @staticmethod
    def validate_search_results(results: Dict[str, Any]):
        """Validate search results structure"""
        required_fields = ["query", "results", "total_count"]
        
        for field in required_fields:
            assert field in results, f"Missing field: {field}"
        
        assert isinstance(results["results"], list)
        assert isinstance(results["total_count"], int)
        assert results["total_count"] >= 0
        
        # Validate individual results
        for result in results["results"]:
            required_result_fields = ["timestamp", "role", "content"]
            for field in required_result_fields:
                assert field in result, f"Missing result field: {field}"


# Pytest fixtures using the helpers
@pytest.fixture
def memory_helper():
    """Provide memory test helper"""
    return MemoryTestHelper()


@pytest.fixture
def chat_helper():
    """Provide chat agent test helper"""
    return ChatAgentTestHelper()


@pytest.fixture
def auth_helper():
    """Provide auth test helper"""
    return AuthTestHelper()


@pytest.fixture
def api_helper():
    """Provide API test helper"""
    return APITestHelper()


@pytest.fixture
def websocket_helper():
    """Provide WebSocket test helper"""
    return WebSocketTestHelper()


@pytest.fixture
def data_helper():
    """Provide data generation helper"""
    return DataGenerationHelper()


@pytest.fixture
def performance_helper():
    """Provide performance test helper"""
    return PerformanceTestHelper()


@pytest.fixture
def validation_helper():
    """Provide validation helper"""
    return ValidationHelper()


# Custom pytest markers
pytest_markers = [
    "slow: marks tests as slow (deselect with '-m \"not slow\"')",
    "integration: marks tests as integration tests",
    "unit: marks tests as unit tests",
    "websocket: marks tests that require WebSocket functionality",
    "memory: marks tests that test memory system functionality",
    "auth: marks tests that test authentication functionality",
]


def pytest_configure(config):
    """Configure pytest markers"""
    for marker in pytest_markers:
        config.addinivalue_line("markers", marker)