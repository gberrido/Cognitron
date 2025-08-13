#!/usr/bin/env python3
"""
Test configuration and fixtures for Cognitron06 server tests
"""

import pytest
import asyncio
import tempfile
import shutil
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient
from httpx import AsyncClient

# Import server components
from src.main import app
from src.core.memory_system import MemGPTMemorySystem
from src.core.chat_agent import ChatAgent
from src.services.session_manager import SessionManager
from src.core.config import Settings


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def temp_data_dir():
    """Create a temporary directory for test data"""
    temp_dir = tempfile.mkdtemp()
    yield Path(temp_dir)
    shutil.rmtree(temp_dir)


@pytest.fixture
def test_settings(temp_data_dir, monkeypatch):
    """Test settings with temporary data directory"""
    # Set environment variables for memory config
    monkeypatch.setenv("COGNITRON_DATA_DIR", str(temp_data_dir))
    monkeypatch.setenv("COGNITRON_MAX_WORKING_CONTEXT", "100")  # Small for testing
    monkeypatch.setenv("COGNITRON_MAX_FIFO_QUEUE", "5")
    monkeypatch.setenv("COGNITRON_MEMORY_PRESSURE", "0.8")
    monkeypatch.setenv("COGNITRON_CONTEXT_WINDOW", "1000")
    
    return Settings(
        groq_api_key="test-api-key",
        secret_key="test-secret-key-for-jwt-tokens-in-tests",
        debug=True
    )


@pytest.fixture(scope="function")
def memory_system(test_settings):
    """Create a test memory system"""
    import asyncio
    
    async def create_and_initialize():
        system = MemGPTMemorySystem(test_settings.memory_config)
        await system.initialize()
        return system
    
    # Create the system synchronously for test access
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    system = loop.run_until_complete(create_and_initialize())
    
    yield system
    
    # Cleanup
    async def cleanup():
        try:
            await system.cleanup()
        except Exception:
            pass
    
    loop.run_until_complete(cleanup())
    loop.close()


@pytest.fixture
def mock_groq_client():
    """Mock Groq client for testing"""
    mock_client = AsyncMock()
    
    # Mock chat completion response
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "Test response"
    mock_response.choices[0].message.tool_calls = []
    mock_response.usage.prompt_tokens = 10
    mock_response.usage.completion_tokens = 5
    mock_response.usage.total_tokens = 15
    
    mock_client.chat.completions.create.return_value = mock_response
    
    return mock_client


@pytest.fixture
def chat_agent(memory_system, mock_groq_client):
    """Create a test chat agent with mocked Groq client"""
    agent = ChatAgent(
        api_key="test-key",
        model="test-model",
        memory_system=memory_system
    )
    agent.groq = mock_groq_client
    return agent


@pytest.fixture
def session_manager():
    """Create a test session manager"""
    return SessionManager()


@pytest.fixture
def test_user_credentials():
    """Test user credentials"""
    return {
        "username": "testuser",
        "password": "testpass123"
    }


@pytest.fixture
def authenticated_user(session_manager, test_user_credentials, test_settings):
    """Create an authenticated test user"""
    # Add user to session manager
    hashed_password = session_manager.get_password_hash(test_user_credentials["password"])
    session_manager.users_db[test_user_credentials["username"]] = {
        "username": test_user_credentials["username"],
        "hashed_password": hashed_password,
        "is_active": True
    }
    
    # Create session
    session_data = session_manager.create_session(
        username=test_user_credentials["username"],
        secret_key=test_settings.secret_key
    )
    
    return {
        "username": test_user_credentials["username"],
        "token": session_data["access_token"],
        "session_id": session_data["session_id"]
    }


@pytest.fixture
def test_client():
    """Create FastAPI test client"""
    return TestClient(app)


@pytest.fixture
async def async_client():
    """Create async HTTP client for testing"""
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client


@pytest.fixture
def auth_headers(authenticated_user):
    """Get authentication headers for requests"""
    return {"Authorization": f"Bearer {authenticated_user['token']}"}


# Sample data fixtures
@pytest.fixture
def sample_chat_messages():
    """Sample chat messages for testing"""
    return [
        {"role": "user", "content": "Hello, how are you?"},
        {"role": "assistant", "content": "I'm doing well, thank you for asking!"},
        {"role": "user", "content": "Tell me about machine learning"},
        {"role": "assistant", "content": "Machine learning is a subset of artificial intelligence..."}
    ]


@pytest.fixture
def sample_working_context():
    """Sample working context entries"""
    return {
        "user_name": "Alice",
        "favorite_topic": "machine learning",
        "location": "San Francisco",
        "occupation": "software engineer"
    }


@pytest.fixture
def sample_archival_data():
    """Sample archival data for testing"""
    return [
        {
            "key": "project_requirements",
            "data": "Build an AI assistant with persistent memory",
            "metadata": {"category": "project", "priority": "high"}
        },
        {
            "key": "user_preferences",
            "data": "Prefers concise responses, interested in technical topics",
            "metadata": {"category": "user", "priority": "medium"}
        }
    ]


# Mock external dependencies
@pytest.fixture(autouse=True)
def mock_app_state(memory_system, chat_agent, session_manager, test_settings):
    """Mock app state for all tests"""
    app.state.memory_system = memory_system
    app.state.chat_agent = chat_agent
    app.state.session_manager = session_manager
    app.state.settings = test_settings
    yield
    # Cleanup is handled by individual fixtures