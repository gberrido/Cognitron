#!/usr/bin/env python3
"""
Unit tests for Chat Agent
"""

import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch

from src.core.chat_agent import ChatAgent


class TestChatAgent:
    """Test cases for Chat Agent"""

    def test_initialization(self, memory_system):
        """Test chat agent initialization"""
        agent = ChatAgent(
            api_key="test-key",
            model="test-model",
            memory_system=memory_system
        )
        
        assert agent.config["api_key"] == "test-key"
        assert agent.config["model"] == "test-model"
        assert agent.config["temperature"] == 0.7
        assert agent.memory_system == memory_system
        assert len(agent.tools) > 0

    def test_system_message_building(self, chat_agent):
        """Test system message construction"""
        user_id = "test_user"
        
        system_msg = chat_agent.build_system_message(user_id)
        
        assert system_msg["role"] == "system"
        assert "Cognitron" in system_msg["content"]
        assert "MemGPT" in system_msg["content"]
        assert "MEMORY ARCHITECTURE" in system_msg["content"]
        assert "MEMORY MANAGEMENT TOOLS" in system_msg["content"]
        assert chat_agent.config["model"] in system_msg["content"]

    def test_system_message_with_working_context(self, chat_agent, memory_system):
        """Test system message includes working context"""
        user_id = "test_user"
        
        # Add working context
        memory_system.updateWorkingContext = AsyncMock()
        memory_system.get_working_context_summary = MagicMock(
            return_value="Working Context:\nuser_name: Alice\noccupation: Engineer"
        )
        
        system_msg = chat_agent.build_system_message(user_id)
        
        assert "user_name: Alice" in system_msg["content"]
        assert "occupation: Engineer" in system_msg["content"]

    def test_conversation_context_generation(self, chat_agent, memory_system):
        """Test conversation context generation"""
        user_id = "test_user"
        
        # Mock FIFO queue context
        mock_context = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"}
        ]
        memory_system.get_fifo_queue_context = MagicMock(return_value=mock_context)
        memory_system.check_memory_pressure = MagicMock(return_value={
            "warning": False,
            "usage": 50,
            "message": None
        })
        
        context = chat_agent.get_conversation_context(user_id)
        
        assert len(context) >= 3  # system + 2 messages
        assert context[0]["role"] == "system"
        assert context[1]["role"] == "user"
        assert context[1]["content"] == "Hello"

    def test_conversation_context_with_memory_pressure(self, chat_agent, memory_system):
        """Test conversation context with memory pressure warning"""
        user_id = "test_user"
        
        # Mock memory pressure warning
        memory_system.get_fifo_queue_context = MagicMock(return_value=[])
        memory_system.check_memory_pressure = MagicMock(return_value={
            "warning": True,
            "usage": 85,
            "message": "Memory usage high"
        })
        
        context = chat_agent.get_conversation_context(user_id)
        
        # Should include memory pressure warning
        warning_messages = [msg for msg in context if "MEMORY PRESSURE WARNING" in msg.get("content", "")]
        assert len(warning_messages) == 1
        assert "85%" in warning_messages[0]["content"]

    @pytest.mark.asyncio
    async def test_tool_execution_core_memory_append(self, chat_agent, memory_system):
        """Test core_memory_append tool execution"""
        user_id = "test_user"
        
        memory_system.update_working_context = AsyncMock(return_value=True)
        
        tool_call = {
            "function": {
                "name": "core_memory_append",
                "arguments": '{"key": "user_name", "value": "Alice"}'
            }
        }
        
        result = await chat_agent.execute_tool(user_id, tool_call)
        
        assert result["success"] is True
        assert "Added to core memory" in result["message"]
        assert "user_name = Alice" in result["message"]
        memory_system.update_working_context.assert_called_once_with(user_id, "user_name", "Alice")

    @pytest.mark.asyncio
    async def test_tool_execution_core_memory_replace(self, chat_agent, memory_system):
        """Test core_memory_replace tool execution"""
        user_id = "test_user"
        
        # Mock existing context
        memory_system.get_working_context = MagicMock(return_value={
            "value": "Old Value",
            "last_updated": "2024-01-01T12:00:00"
        })
        memory_system.update_working_context = AsyncMock(return_value=True)
        
        tool_call = {
            "function": {
                "name": "core_memory_replace",
                "arguments": '{"key": "user_name", "new_value": "Alice Smith"}'
            }
        }
        
        result = await chat_agent.execute_tool(user_id, tool_call)
        
        assert result["success"] is True
        assert "Updated core memory" in result["message"]
        assert "Previous value: Old Value" in result["details"]

    @pytest.mark.asyncio
    async def test_tool_execution_conversation_search(self, chat_agent, memory_system):
        """Test conversation_search tool execution"""
        user_id = "test_user"
        
        # Mock search results
        mock_results = [
            {
                "timestamp": "2024-01-01T12:00:00",
                "role": "user",
                "content": "I love machine learning algorithms and neural networks",
                "relevance_score": 8.5
            }
        ]
        memory_system.search_recall_storage = MagicMock(return_value=mock_results)
        
        tool_call = {
            "function": {
                "name": "conversation_search",
                "arguments": '{"query": "machine learning", "max_results": 5}'
            }
        }
        
        result = await chat_agent.execute_tool(user_id, tool_call)
        
        assert result["success"] is True
        assert result["count"] == 1
        assert result["query"] == "machine learning"
        assert len(result["results"]) == 1
        assert result["results"][0]["relevance"] == 8.5

    @pytest.mark.asyncio
    async def test_tool_execution_archival_memory_insert(self, chat_agent, memory_system):
        """Test archival_memory_insert tool execution"""
        user_id = "test_user"
        
        memory_system.insert_archival = AsyncMock(return_value=True)
        
        tool_call = {
            "function": {
                "name": "archival_memory_insert",
                "arguments": '{"key": "project_info", "data": "Building an AI assistant"}'
            }
        }
        
        result = await chat_agent.execute_tool(user_id, tool_call)
        
        assert result["success"] is True
        assert "Stored in archival memory" in result["message"]
        memory_system.insert_archival.assert_called_once_with(
            user_id, "project_info", "Building an AI assistant"
        )

    @pytest.mark.asyncio
    async def test_tool_execution_get_memory_status(self, chat_agent, memory_system):
        """Test get_memory_status tool execution"""
        user_id = "test_user"
        
        # Mock status
        mock_status = MagicMock()
        mock_status.working_context_size = 3
        mock_status.fifo_queue_length = 5
        mock_status.recall_storage_size = 50
        mock_status.archival_storage_size = 2
        
        memory_system.get_status = MagicMock(return_value=mock_status)
        memory_system.check_memory_pressure = MagicMock(return_value={
            "usage": 65,
            "estimated_tokens": 1300,
            "context_window": 2000
        })
        
        tool_call = {
            "function": {
                "name": "get_memory_status",
                "arguments": '{}'
            }
        }
        
        result = await chat_agent.execute_tool(user_id, tool_call)
        
        assert result["success"] is True
        assert result["status"]["working_context"] == 3
        assert result["status"]["memory_pressure"] == "65%"

    @pytest.mark.asyncio
    async def test_tool_execution_unknown_function(self, chat_agent):
        """Test unknown function handling"""
        user_id = "test_user"
        
        tool_call = {
            "function": {
                "name": "unknown_function",
                "arguments": '{"param": "value"}'
            }
        }
        
        result = await chat_agent.execute_tool(user_id, tool_call)
        
        assert "error" in result
        assert "Unknown function" in result["error"]

    @pytest.mark.asyncio
    async def test_tool_execution_invalid_json(self, chat_agent):
        """Test invalid JSON handling in tool execution"""
        user_id = "test_user"
        
        tool_call = {
            "function": {
                "name": "core_memory_append",
                "arguments": 'invalid json'
            }
        }
        
        result = await chat_agent.execute_tool(user_id, tool_call)
        
        assert "error" in result
        assert "Tool execution failed" in result["error"]

    @pytest.mark.asyncio
    async def test_generate_response_without_memory(self, mock_groq_client):
        """Test response generation without memory system"""
        agent = ChatAgent(api_key="test-key", model="test-model")
        agent.groq = mock_groq_client
        
        response = await agent.generate_response("test_user", "Hello")
        
        assert response["content"] == "Test response"
        assert response["tool_calls"] == []
        assert "usage" in response

    @pytest.mark.asyncio
    async def test_generate_response_with_memory(self, chat_agent, memory_system):
        """Test response generation with memory system"""
        user_id = "test_user"
        
        memory_system.add_to_fifo_queue = AsyncMock(return_value="msg-123")
        
        response = await chat_agent.generate_response(user_id, "Hello")
        
        assert response["content"] == "Test response"
        memory_system.add_to_fifo_queue.assert_called_with(user_id, "user", "Hello")

    @pytest.mark.asyncio
    async def test_generate_response_with_tool_calls(self, chat_agent, memory_system):
        """Test response generation with tool calls"""
        user_id = "test_user"
        
        # Mock Groq response with tool calls
        mock_tool_call = MagicMock()
        mock_tool_call.id = "call-123"
        mock_tool_call.function.name = "core_memory_append"
        mock_tool_call.function.arguments = '{"key": "test", "value": "data"}'
        
        chat_agent.groq.chat.completions.create.return_value.choices[0].message.tool_calls = [mock_tool_call]
        memory_system.add_to_fifo_queue = AsyncMock(return_value="msg-123")
        memory_system.update_working_context = AsyncMock(return_value=True)
        
        response = await chat_agent.generate_response(user_id, "Remember my name is Alice")
        
        assert len(response["tool_calls"]) == 1
        assert response["tool_calls"][0]["function_name"] == "core_memory_append"
        assert response["tool_calls"][0]["result"]["success"] is True

    @pytest.mark.asyncio
    async def test_generate_streaming_response(self, chat_agent):
        """Test streaming response generation"""
        user_id = "test_user"
        api_options = {
            "model": "test-model",
            "messages": [{"role": "user", "content": "Hello"}],
            "stream": True
        }
        
        # Mock streaming response
        async def mock_stream():
            chunks = [
                MagicMock(choices=[MagicMock(delta=MagicMock(content="Hello"))]),
                MagicMock(choices=[MagicMock(delta=MagicMock(content=" there"))]),
                MagicMock(choices=[MagicMock(delta=MagicMock(content="!"))])
            ]
            for chunk in chunks:
                yield chunk
        
        chat_agent.groq.chat.completions.create.return_value = mock_stream()
        
        content_chunks = []
        async for chunk in await chat_agent._generate_streaming_response(user_id, api_options):
            content_chunks.append(chunk)
        
        assert content_chunks == ["Hello", " there", "!"]

    def test_config_update(self, chat_agent):
        """Test configuration updates"""
        new_config = {
            "temperature": 1.0,
            "max_tokens": 1000,
            "reasoning_level": "high"
        }
        
        chat_agent.update_config(new_config)
        
        assert chat_agent.config["temperature"] == 1.0
        assert chat_agent.config["max_tokens"] == 1000
        assert chat_agent.config["reasoning_level"] == "high"

    def test_get_status(self, chat_agent):
        """Test agent status retrieval"""
        status = chat_agent.get_status()
        
        assert "model" in status
        assert "temperature" in status
        assert "reasoning_level" in status
        assert "available_tools" in status
        assert status["available_tools"] == len(chat_agent.tools)

    def test_tool_definitions_structure(self, chat_agent):
        """Test that all tools have proper structure"""
        for tool in chat_agent.tools:
            assert tool["type"] == "function"
            assert "function" in tool
            assert "name" in tool["function"]
            assert "description" in tool["function"]
            assert "parameters" in tool["function"]
            
            # Check parameters structure
            params = tool["function"]["parameters"]
            assert params["type"] == "object"
            assert "properties" in params
            assert "required" in params

    @pytest.mark.asyncio
    async def test_memory_system_none_handling(self):
        """Test graceful handling when memory system is None"""
        agent = ChatAgent(api_key="test-key", model="test-model", memory_system=None)
        
        # Tool execution should return error
        result = await agent.execute_tool("user", {"function": {"name": "test", "arguments": "{}"}})
        assert "error" in result
        assert "Memory system not available" in result["error"]
        
        # Context should only include system message
        context = agent.get_conversation_context("user")
        assert len(context) == 1
        assert context[0]["role"] == "system"

    @pytest.mark.asyncio 
    async def test_error_handling_in_generate_response(self, chat_agent):
        """Test error handling in response generation"""
        user_id = "test_user"
        
        # Mock Groq client to raise exception
        chat_agent.groq.chat.completions.create.side_effect = Exception("API Error")
        
        response = await chat_agent.generate_response(user_id, "Hello")
        
        assert "error" in response
        assert "Failed to generate response" in response["error"]
        assert response["content"] is None