#!/usr/bin/env python3
"""
Unit tests for MemGPT Memory System
"""

import pytest
import json
from datetime import datetime
from pathlib import Path

from src.core.memory_system import MemGPTMemorySystem, Message, MemoryStatus


class TestMemGPTMemorySystem:
    """Test cases for MemGPT Memory System"""

    @pytest.mark.asyncio
    async def test_initialization(self, temp_data_dir):
        """Test memory system initialization"""
        config = {
            "data_dir": str(temp_data_dir),
            "max_working_context_size": 100,
            "max_fifo_queue_size": 5
        }
        
        memory = MemGPTMemorySystem(config)
        await memory.initialize()
        
        assert memory.config["data_dir"] == Path(str(temp_data_dir))
        assert memory.config["max_working_context_size"] == 100
        assert memory.config["max_fifo_queue_size"] == 5
        assert memory.user_memories == {}

    @pytest.mark.asyncio
    async def test_user_memory_creation(self, memory_system):
        """Test user memory structure creation"""
        user_id = "test_user"
        
        # Access user memory (should create it)
        memory = memory_system._get_user_memory(user_id)
        
        assert user_id in memory_system.user_memories
        assert "working_context" in memory
        assert "fifo_queue" in memory
        assert "recursive_summary" in memory
        assert "recall_storage" in memory
        assert "archival_storage" in memory
        assert "current_session_id" in memory
        
        # Verify initial values
        assert memory["working_context"] == {}
        assert memory["fifo_queue"] == []
        assert memory["recall_storage"] == []
        assert memory["archival_storage"] == {}
        assert memory["recursive_summary"] == ""

    @pytest.mark.asyncio
    async def test_working_context_operations(self, memory_system):
        """Test working context CRUD operations"""
        user_id = "test_user"
        
        # Test update
        result = await memory_system.update_working_context(user_id, "user_name", "Alice")
        assert result is True
        
        # Test get
        entry = memory_system.get_working_context(user_id, "user_name")
        assert entry is not None
        assert entry["value"] == "Alice"
        assert entry["update_count"] == 1
        assert "last_updated" in entry
        
        # Test update existing
        await memory_system.update_working_context(user_id, "user_name", "Alice Smith")
        entry = memory_system.get_working_context(user_id, "user_name")
        assert entry["value"] == "Alice Smith"
        assert entry["update_count"] == 2
        
        # Test get all
        await memory_system.update_working_context(user_id, "occupation", "Engineer")
        all_context = memory_system.get_working_context(user_id)
        assert len(all_context) == 2
        assert "user_name" in all_context
        assert "occupation" in all_context

    @pytest.mark.asyncio
    async def test_working_context_summary(self, memory_system):
        """Test working context summary generation"""
        user_id = "test_user"
        
        # Empty context
        summary = memory_system.get_working_context_summary(user_id)
        assert summary == "Working context is empty."
        
        # With data
        await memory_system.update_working_context(user_id, "user_name", "Alice")
        await memory_system.update_working_context(user_id, "occupation", "Engineer")
        
        summary = memory_system.get_working_context_summary(user_id)
        assert "Working Context:" in summary
        assert "user_name: Alice" in summary
        assert "occupation: Engineer" in summary

    @pytest.mark.asyncio
    async def test_fifo_queue_operations(self, memory_system):
        """Test FIFO queue message handling"""
        user_id = "test_user"
        session_id = "test_session"
        
        # Add message
        message_id = await memory_system.add_to_fifo_queue(
            user_id, "user", "Hello!", session_id
        )
        
        assert message_id is not None
        
        memory = memory_system._get_user_memory(user_id)
        assert len(memory["fifo_queue"]) == 1
        assert len(memory["recall_storage"]) == 1
        
        message = memory["fifo_queue"][0]
        assert message["role"] == "user"
        assert message["content"] == "Hello!"
        assert message["session_id"] == session_id
        assert message["user_id"] == user_id

    @pytest.mark.asyncio
    async def test_fifo_queue_management(self, memory_system):
        """Test FIFO queue size management and summarization"""
        user_id = "test_user"
        
        # Fill queue beyond limit
        max_size = memory_system.config["max_fifo_queue_size"]
        for i in range(max_size + 3):
            await memory_system.add_to_fifo_queue(
                user_id, "user", f"Message {i}"
            )
        
        memory = memory_system._get_user_memory(user_id)
        
        # Queue should be at max size
        assert len(memory["fifo_queue"]) == max_size
        
        # All messages should be in recall storage
        assert len(memory["recall_storage"]) == max_size + 3
        
        # Should have created recursive summary
        assert memory["recursive_summary"] != ""
        assert "Conversation history summary:" in memory["recursive_summary"]

    @pytest.mark.asyncio
    async def test_empty_content_handling(self, memory_system):
        """Test handling of empty or invalid content"""
        user_id = "test_user"
        
        # Test empty content
        result = await memory_system.add_to_fifo_queue(user_id, "user", "")
        assert result is None
        
        # Test None content
        result = await memory_system.add_to_fifo_queue(user_id, "user", None)
        assert result is None
        
        # Test whitespace only
        result = await memory_system.add_to_fifo_queue(user_id, "user", "   ")
        assert result is None
        
        memory = memory_system._get_user_memory(user_id)
        assert len(memory["fifo_queue"]) == 0
        assert len(memory["recall_storage"]) == 0

    @pytest.mark.asyncio
    async def test_fifo_context_generation(self, memory_system):
        """Test FIFO queue context generation for AI"""
        user_id = "test_user"
        
        # Add messages
        await memory_system.add_to_fifo_queue(user_id, "user", "Hello")
        await memory_system.add_to_fifo_queue(user_id, "assistant", "Hi there!")
        
        context = memory_system.get_fifo_queue_context(user_id)
        
        assert len(context) == 2
        assert context[0]["role"] == "user"
        assert context[0]["content"] == "Hello"
        assert context[1]["role"] == "assistant"
        assert context[1]["content"] == "Hi there!"

    @pytest.mark.asyncio
    async def test_recall_storage_search(self, memory_system):
        """Test recall storage search functionality"""
        user_id = "test_user"
        
        # Add test messages
        await memory_system.add_to_fifo_queue(user_id, "user", "I love machine learning")
        await memory_system.add_to_fifo_queue(user_id, "assistant", "That's great! ML is fascinating")
        await memory_system.add_to_fifo_queue(user_id, "user", "Tell me about Python")
        await memory_system.add_to_fifo_queue(user_id, "assistant", "Python is a programming language")
        
        # Test search - should find exact match
        results = memory_system.search_recall_storage(user_id, "machine learning")
        assert len(results) == 1  # Should find the exact match
        assert results[0]["relevance_score"] > 0
        assert "machine learning" in results[0]["content"].lower()
        
        # Test broader search
        results_broad = memory_system.search_recall_storage(user_id, "learning")
        assert len(results_broad) == 1  # Should still find the machine learning message
        
        # Test search with no results
        results = memory_system.search_recall_storage(user_id, "nonexistent topic")
        assert len(results) == 0
        
        # Test empty query
        results = memory_system.search_recall_storage(user_id, "")
        assert len(results) == 0

    @pytest.mark.asyncio
    async def test_search_relevance_scoring(self, memory_system):
        """Test search relevance scoring"""
        user_id = "test_user"
        
        # Add messages with different relevance
        await memory_system.add_to_fifo_queue(user_id, "user", "machine learning algorithms")  # High relevance
        await memory_system.add_to_fifo_queue(user_id, "user", "I study machine learning")     # Medium relevance
        await memory_system.add_to_fifo_queue(user_id, "user", "learning new things")         # Low relevance
        
        results = memory_system.search_recall_storage(user_id, "machine learning")
        
        assert len(results) >= 2
        # Results should be sorted by relevance (highest first)
        assert results[0]["relevance_score"] >= results[1]["relevance_score"]

    @pytest.mark.asyncio
    async def test_archival_storage_operations(self, memory_system):
        """Test archival storage CRUD operations"""
        user_id = "test_user"
        
        # Test insert
        result = await memory_system.insert_archival(
            user_id, "test_key", "test data", {"category": "test"}
        )
        assert result is True
        
        memory = memory_system._get_user_memory(user_id)
        assert "test_key" in memory["archival_storage"]
        
        entry = memory["archival_storage"]["test_key"]
        assert entry["data"] == "test data"
        assert entry["metadata"]["category"] == "test"
        assert "stored" in entry

    @pytest.mark.asyncio
    async def test_archival_storage_search(self, memory_system):
        """Test archival storage search"""
        user_id = "test_user"
        
        # Insert test data
        await memory_system.insert_archival(user_id, "project_info", "AI assistant project")
        await memory_system.insert_archival(user_id, "user_prefs", "likes concise responses")
        await memory_system.insert_archival(user_id, "meeting_notes", "discussed project timeline")
        
        # Test search
        results = memory_system.search_archival(user_id, "project")
        assert len(results) == 2  # Should find project_info and meeting_notes
        
        # Verify result structure
        assert all("key" in result for result in results)
        assert all("data" in result for result in results)
        assert all("stored" in result for result in results)

    @pytest.mark.asyncio
    async def test_memory_pressure_calculation(self, memory_system):
        """Test memory pressure calculation"""
        user_id = "test_user"
        
        # Add some data
        await memory_system.update_working_context(user_id, "key1", "value1")
        await memory_system.add_to_fifo_queue(user_id, "user", "test message")
        
        pressure = memory_system.check_memory_pressure(user_id)
        
        assert "usage" in pressure
        assert "estimated_tokens" in pressure
        assert "context_window" in pressure
        assert "warning" in pressure
        assert pressure["usage"] >= 0
        assert pressure["estimated_tokens"] >= 0
        assert isinstance(pressure["warning"], bool)

    @pytest.mark.asyncio
    async def test_memory_status(self, memory_system):
        """Test comprehensive memory status"""
        user_id = "test_user"
        
        # Add test data
        await memory_system.update_working_context(user_id, "key1", "value1")
        await memory_system.add_to_fifo_queue(user_id, "user", "message1")
        await memory_system.insert_archival(user_id, "arch_key", "arch_data")
        
        status = memory_system.get_status(user_id)
        
        assert isinstance(status, MemoryStatus)
        assert status.user_id == user_id
        assert status.working_context_size == 1
        assert status.fifo_queue_length == 1
        assert status.recall_storage_size == 1
        assert status.archival_storage_size == 1
        assert status.memory_pressure >= 0

    @pytest.mark.asyncio
    async def test_data_persistence(self, memory_system, temp_data_dir):
        """Test data persistence to disk"""
        user_id = "test_user"
        
        # Add data
        await memory_system.update_working_context(user_id, "persistent_key", "persistent_value")
        await memory_system.add_to_fifo_queue(user_id, "user", "persistent message")
        await memory_system.insert_archival(user_id, "arch_key", "arch_value")
        
        # Save data
        await memory_system._save_working_context(user_id)
        await memory_system._save_recall_storage(user_id)
        await memory_system._save_archival_storage(user_id)
        
        # Verify files exist
        working_context_file = temp_data_dir / f"{user_id}_working_context.json"
        recall_storage_file = temp_data_dir / f"{user_id}_recall_storage.jsonl"
        archival_storage_file = temp_data_dir / f"{user_id}_archival_storage.json"
        
        assert working_context_file.exists()
        assert recall_storage_file.exists()
        assert archival_storage_file.exists()
        
        # Verify content
        with open(working_context_file) as f:
            context_data = json.load(f)
            assert "persistent_key" in context_data
            assert context_data["persistent_key"]["value"] == "persistent_value"

    @pytest.mark.asyncio
    async def test_cleanup(self, memory_system):
        """Test memory system cleanup"""
        user_id = "test_user"
        
        # Add data
        await memory_system.update_working_context(user_id, "key", "value")
        await memory_system.add_to_fifo_queue(user_id, "user", "message")
        
        # Test cleanup doesn't raise errors
        await memory_system.cleanup()
        
        # Should still be able to access data
        memory = memory_system._get_user_memory(user_id)
        assert "working_context" in memory

    @pytest.mark.asyncio
    async def test_session_id_generation(self, memory_system):
        """Test session ID generation"""
        session_id1 = memory_system._generate_session_id()
        session_id2 = memory_system._generate_session_id()
        
        assert session_id1 != session_id2
        assert session_id1.startswith("session-")
        assert session_id2.startswith("session-")
        assert len(session_id1) > 20  # Should have timestamp + random part

    @pytest.mark.asyncio
    async def test_message_model(self):
        """Test Message dataclass"""
        message = Message(
            id="test-id",
            timestamp="2024-01-01T12:00:00",
            session_id="test-session",
            user_id="test-user",
            role="user",
            content="test content"
        )
        
        assert message.id == "test-id"
        assert message.role == "user"
        assert message.content == "test content"
        assert message.metadata == {}
        
        # Test with metadata
        message_with_meta = Message(
            id="test-id",
            timestamp="2024-01-01T12:00:00",
            session_id="test-session", 
            user_id="test-user",
            role="assistant",
            content="response",
            metadata={"tool_call": True}
        )
        
        assert message_with_meta.metadata["tool_call"] is True