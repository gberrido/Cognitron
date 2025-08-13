# Cognitron06 Server Tests

Comprehensive test suite for the Cognitron06 server implementation.

## Test Structure

```
tests/
├── conftest.py              # Test configuration and fixtures
├── test_memory_system.py    # MemGPT memory system tests
├── test_chat_agent.py       # Chat agent and Groq integration tests
├── test_session_manager.py  # Authentication and session tests
├── test_api_endpoints.py    # REST API endpoint tests
├── test_websocket.py        # WebSocket functionality tests
├── test_integration.py      # End-to-end integration tests
├── test_utils.py           # Test utilities and helpers
├── pytest.ini             # Pytest configuration
└── README.md              # This file
```

## Running Tests

### Install Dependencies
```bash
pip install -r requirements-dev.txt
```

### Run All Tests
```bash
# From server directory
python -m pytest

# With coverage
python -m pytest --cov=src --cov-report=html
```

### Run Specific Test Categories
```bash
# Unit tests only
python -m pytest -m unit

# Integration tests only
python -m pytest -m integration

# Memory system tests
python -m pytest -m memory

# API tests
python -m pytest -m api

# Exclude slow tests
python -m pytest -m "not slow"
```

### Run Specific Test Files
```bash
python -m pytest tests/test_memory_system.py
python -m pytest tests/test_api_endpoints.py -v
python -m pytest tests/test_integration.py::TestFullUserJourney
```

## Test Categories

### Unit Tests (`-m unit`)
Test individual components in isolation:
- MemGPT memory system operations
- Chat agent functionality
- Session manager authentication
- WebSocket connection management

### Integration Tests (`-m integration`)
Test complete user workflows:
- Full user session from login to logout
- Memory persistence across sessions
- Multi-user concurrent access
- System robustness and error recovery

### API Tests (`-m api`)
Test REST API endpoints:
- Authentication endpoints
- Chat message endpoints
- Memory management endpoints
- Error handling and validation

### WebSocket Tests (`-m websocket`)
Test real-time functionality:
- WebSocket connection management
- Streaming chat responses
- Real-time message handling

## Test Fixtures

### Core Fixtures (conftest.py)
- `memory_system`: Initialized MemGPT memory system
- `chat_agent`: Chat agent with mocked Groq client
- `session_manager`: Session manager with demo user
- `authenticated_user`: Pre-authenticated test user
- `test_client`: FastAPI test client
- `async_client`: Async HTTP test client

### Data Fixtures
- `sample_chat_messages`: Example conversation messages
- `sample_working_context`: Example memory context
- `sample_archival_data`: Example archival storage data

### Helper Classes (test_utils.py)
- `MemoryTestHelper`: Memory system test utilities
- `ChatAgentTestHelper`: Chat agent test utilities
- `AuthTestHelper`: Authentication test utilities
- `APITestHelper`: API testing utilities
- `WebSocketTestHelper`: WebSocket testing utilities

## Writing New Tests

### Test Naming Convention
- File names: `test_<component>.py`
- Class names: `Test<ComponentName>`
- Method names: `test_<functionality>`

### Using Fixtures
```python
@pytest.mark.asyncio
async def test_memory_operation(memory_system, memory_helper):
    user_id = "test_user"
    
    # Use helper to populate test data
    await memory_helper.populate_memory(memory_system, user_id, 5)
    
    # Test the functionality
    status = memory_system.get_status(user_id)
    assert status.recall_storage_size == 5
```

### Async Testing
```python
@pytest.mark.asyncio
async def test_async_function(async_client, auth_headers):
    response = await async_client.post(
        "/api/v1/chat/message",
        headers=auth_headers,
        json={"message": "Hello"}
    )
    assert response.status_code == 200
```

### Mocking External Dependencies
```python
@pytest.mark.asyncio
async def test_with_mock(chat_agent, mock_groq_client):
    # Groq client is already mocked in fixture
    response = await chat_agent.generate_response("user", "Hello")
    assert "content" in response
```

## Test Data Management

### Temporary Data
Tests use temporary directories for data storage that are automatically cleaned up.

### Isolated Users
Each test gets isolated user data to prevent interference between tests.

### Realistic Data
Test data mirrors real-world usage patterns with:
- Realistic conversation flows
- Unicode and special characters
- Various data sizes and types

## Performance Testing

### Memory System Performance
```bash
# Test with large datasets
python -m pytest tests/test_integration.py::TestSystemRobustness::test_large_dataset_handling
```

### Concurrent Access
```bash
# Test concurrent user sessions
python -m pytest tests/test_integration.py::TestFullUserJourney::test_concurrent_user_sessions
```

## Debugging Tests

### Verbose Output
```bash
python -m pytest -v -s tests/test_memory_system.py
```

### Stop on First Failure
```bash
python -m pytest -x
```

### Debug Specific Test
```bash
python -m pytest --pdb tests/test_memory_system.py::TestMemGPTMemorySystem::test_fifo_queue_operations
```

### View Logs
```bash
python -m pytest --log-cli-level=DEBUG
```

## Coverage Reports

### Generate HTML Coverage Report
```bash
python -m pytest --cov=src --cov-report=html
open htmlcov/index.html
```

### View Coverage Summary
```bash
python -m pytest --cov=src --cov-report=term-missing
```

## Continuous Integration

Tests are designed to run in CI environments with:
- No external dependencies (mocked Groq API)
- Temporary data directories
- Predictable execution order
- Comprehensive error reporting

### CI Command
```bash
python -m pytest --cov=src --cov-report=xml --junitxml=test-results.xml
```

## Troubleshooting

### Common Issues

1. **Import Errors**
   ```bash
   export PYTHONPATH=/path/to/cognitron06/server:$PYTHONPATH
   ```

2. **Async Warnings**
   - Tests use `pytest-asyncio` for proper async support
   - Ensure `@pytest.mark.asyncio` on async test functions

3. **Fixture Scope Issues**
   - Most fixtures are function-scoped for isolation
   - Use session-scoped fixtures sparingly

4. **Mock Not Working**
   - Ensure mocks are set up before calling tested functions
   - Check mock call arguments and return values

### Getting Help

- Check test output for detailed error messages
- Use `pytest --collect-only` to see test discovery
- Run individual test files to isolate issues
- Review fixture definitions in `conftest.py`

## Best Practices

1. **Test Isolation**: Each test should be independent
2. **Clear Assertions**: Use descriptive assertion messages
3. **Realistic Data**: Use realistic test data patterns
4. **Error Testing**: Test both success and failure cases
5. **Performance**: Mark slow tests with `@pytest.mark.slow`
6. **Documentation**: Document complex test scenarios
7. **Cleanup**: Ensure proper cleanup in fixtures