#!/usr/bin/env python3
"""
MemGPT-Inspired Memory System for Cognitron06 Server
Python port of the JavaScript memory system with async support
"""

import json
import aiofiles
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
import re
import uuid

logger = logging.getLogger(__name__)


@dataclass
class Message:
    """Represents a single message in the conversation"""
    id: str
    timestamp: str
    session_id: str
    user_id: str
    role: str
    content: str
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


@dataclass
class MemoryStatus:
    """Memory system status information"""
    session_id: str
    user_id: str
    working_context_size: int
    fifo_queue_length: int
    recall_storage_size: int
    archival_storage_size: int
    context_token_count: int
    memory_pressure: float
    last_save_time: str


class MemGPTMemorySystem:
    """MemGPT-inspired memory system with hierarchical storage"""
    
    def __init__(self, config: Dict[str, Any]):
        # Process config with proper data_dir Path conversion
        processed_config = {
            "data_dir": config.get("data_dir", "./cognitron06-data"),
            "max_working_context_size": config.get("max_working_context_size", 2000),
            "max_fifo_queue_size": config.get("max_fifo_queue_size", 20),
            "memory_pressure_threshold": config.get("memory_pressure_threshold", 0.8),
            "context_window_size": config.get("context_window_size", 8192),
        }
        processed_config.update(config)  # Allow config to override defaults
        
        # Convert data_dir to Path after all config processing
        self.config = processed_config.copy()
        self.config["data_dir"] = Path(processed_config["data_dir"])
        
        # MemGPT Memory Architecture (per user)
        self.user_memories: Dict[str, Dict] = {}
        self.message_id_counter = 0
        
        # Ensure data directory exists
        self.config["data_dir"].mkdir(parents=True, exist_ok=True)
    
    async def initialize(self):
        """Initialize the MemGPT memory system"""
        logger.info("Initializing MemGPT Memory System...")
        try:
            # Load any existing data
            await self._load_global_state()
            logger.info("✅ MemGPT Memory System initialized")
        except Exception as e:
            logger.error(f"❌ Error initializing MemGPT memory system: {e}")
            raise
    
    def _get_user_memory(self, user_id: str) -> Dict:
        """Get or create memory structure for a user"""
        if user_id not in self.user_memories:
            self.user_memories[user_id] = {
                "working_context": {},  # Core memory
                "fifo_queue": [],       # Recent conversation
                "recursive_summary": "", # Summary of evicted messages
                "recall_storage": [],   # All messages
                "archival_storage": {}, # Long-term structured data
                "current_session_id": self._generate_session_id(),
                "context_token_count": 0,
                "memory_pressure_warning": False,
                "last_save_time": datetime.now().isoformat()
            }
        return self.user_memories[user_id]

    # Public accessors
    def get_current_session_id(self, user_id: str) -> str:
        """Public accessor for the current session ID"""
        memory = self._get_user_memory(user_id)
        return memory.get("current_session_id")

    def get_user_memory_snapshot(self, user_id: str) -> Dict:
        """Return a shallow, read-only snapshot of user memory metadata"""
        memory = self._get_user_memory(user_id)
        return {
            "current_session_id": memory.get("current_session_id"),
            "working_context_size": len(memory.get("working_context", {})),
            "fifo_queue_length": len(memory.get("fifo_queue", [])),
            "recall_storage_size": len(memory.get("recall_storage", [])),
            "archival_storage_size": len(memory.get("archival_storage", {})),
            "context_token_count": memory.get("context_token_count", 0),
            "memory_pressure_warning": memory.get("memory_pressure_warning", False),
            "last_save_time": memory.get("last_save_time"),
        }
    
    def _generate_session_id(self) -> str:
        """Generate unique session ID"""
        now = datetime.now()
        date_str = now.strftime("%Y%m%d%H%M%S")
        random_str = str(uuid.uuid4())[:8]
        return f"session-{date_str}-{random_str}"
    
    # =============================================================================
    # WORKING CONTEXT (Core Memory)
    # =============================================================================
    
    async def update_working_context(self, user_id: str, key: str, value: str, metadata: Dict = None) -> bool:
        """Update working context - core facts about user, preferences, etc."""
        memory = self._get_user_memory(user_id)
        
        if metadata is None:
            metadata = {}
        
        old_entry = memory["working_context"].get(key, {})
        memory["working_context"][key] = {
            "value": value,
            "last_updated": datetime.now().isoformat(),
            "update_count": old_entry.get("update_count", 0) + 1,
            **metadata
        }
        
        await self._save_working_context(user_id)
        return True
    
    def get_working_context(self, user_id: str, key: str = None) -> Any:
        """Get working context value(s)"""
        memory = self._get_user_memory(user_id)
        if key:
            return memory["working_context"].get(key)
        return memory["working_context"]
    
    def get_working_context_summary(self, user_id: str) -> str:
        """Get all working context as formatted string for AI"""
        memory = self._get_user_memory(user_id)
        context = memory["working_context"]
        
        if not context:
            return "Working context is empty."
        
        entries = [f"{key}: {data['value']}" for key, data in context.items()]
        return f"Working Context:\n" + "\n".join(entries)
    
    async def replace_working_context(self, user_id: str, old_key: str, new_key: str, new_value: str):
        """Replace working context entry"""
        memory = self._get_user_memory(user_id)
        if old_key in memory["working_context"]:
            del memory["working_context"][old_key]
        await self.update_working_context(user_id, new_key, new_value)
    
    # =============================================================================
    # FIFO QUEUE (Recent conversation window)
    # =============================================================================
    
    async def add_to_fifo_queue(self, user_id: str, role: str, content: str, session_id: str = None, metadata: Dict = None) -> str:
        """Add message to FIFO queue and recall storage"""
        if not content or not isinstance(content, str) or not content.strip():
            logger.warning("Skipping empty or invalid content for FIFO queue")
            return None
        
        memory = self._get_user_memory(user_id)
        
        if session_id is None:
            session_id = memory["current_session_id"]
        
        if metadata is None:
            metadata = {}
        
        message_id = str(uuid.uuid4())
        timestamp = datetime.now().isoformat()
        
        message = Message(
            id=message_id,
            timestamp=timestamp,
            session_id=session_id,
            user_id=user_id,
            role=role,
            content=content.strip(),
            metadata=metadata
        )
        
        # Add to FIFO queue
        memory["fifo_queue"].append(asdict(message))
        
        # Add to recall storage (permanent record)
        memory["recall_storage"].append(asdict(message))
        
        # Check if queue needs management
        await self._manage_queue(user_id)
        
        # Auto-save periodically
        if len(memory["recall_storage"]) % 10 == 0:
            await self._save_recall_storage(user_id)
        
        return message_id
    
    async def _manage_queue(self, user_id: str):
        """Manage FIFO queue size and create summaries"""
        memory = self._get_user_memory(user_id)
        max_size = self.config["max_fifo_queue_size"]
        
        if len(memory["fifo_queue"]) <= max_size:
            return
        
        # Calculate how many messages to evict
        messages_to_evict = len(memory["fifo_queue"]) - max_size
        evicted_messages = memory["fifo_queue"][:messages_to_evict]
        memory["fifo_queue"] = memory["fifo_queue"][messages_to_evict:]
        
        # Update recursive summary
        await self._update_recursive_summary(user_id, evicted_messages)
        
        logger.info(f"Queue management for {user_id}: Evicted {messages_to_evict} messages")
    
    async def _update_recursive_summary(self, user_id: str, new_evicted_messages: List[Dict]):
        """Update recursive summary with evicted messages"""
        memory = self._get_user_memory(user_id)
        
        evicted_text = "\n".join([
            f"{msg['role']}: {msg['content']}" for msg in new_evicted_messages
        ])
        
        if memory["recursive_summary"]:
            memory["recursive_summary"] = (
                f"Previous summary: {memory['recursive_summary']}\n\n"
                f"Recently evicted:\n{evicted_text}"
            )
        else:
            memory["recursive_summary"] = f"Conversation history summary:\n{evicted_text}"
        
        # Truncate if summary gets too long
        if len(memory["recursive_summary"]) > 1000:
            memory["recursive_summary"] = memory["recursive_summary"][:1000] + "...[truncated]"
    
    def get_fifo_queue_context(self, user_id: str) -> List[Dict]:
        """Get FIFO queue as conversation context"""
        memory = self._get_user_memory(user_id)
        messages = []
        
        # Add recursive summary if exists
        if memory["recursive_summary"]:
            messages.append({
                "role": "system",
                "content": f"[Conversation Summary]: {memory['recursive_summary']}"
            })
        
        # Add current queue messages
        for msg in memory["fifo_queue"]:
            messages.append({
                "role": msg["role"],
                "content": msg["content"]
            })
        
        return messages
    
    # =============================================================================
    # RECALL STORAGE (Searchable message history)
    # =============================================================================
    
    def search_recall_storage(self, user_id: str, query: str, options: Dict = None) -> List[Dict]:
        """Search recall storage for relevant messages"""
        if options is None:
            options = {}
        
        max_results = options.get("max_results", 10)
        session_filter = options.get("session_filter")
        
        if not query or not isinstance(query, str) or not query.strip():
            return []
        
        memory = self._get_user_memory(user_id)
        query_lower = query.lower()
        results = []
        
        for message in memory["recall_storage"]:
            if not message.get("content") or not isinstance(message["content"], str):
                continue
            
            # Apply filters
            if session_filter and message.get("session_id") != session_filter:
                continue
            
            # Simple text search
            if query_lower in message["content"].lower():
                result = message.copy()
                result["relevance_score"] = self._calculate_relevance_score(message, query)
                results.append(result)
        
        # Sort by relevance and timestamp
        results.sort(key=lambda x: (-x["relevance_score"], -datetime.fromisoformat(x["timestamp"]).timestamp()))
        
        return results[:max_results]
    
    def _calculate_relevance_score(self, message: Dict, query: str) -> float:
        """Calculate relevance score for search results"""
        content = message["content"].lower()
        query_lower = query.lower()
        
        score = 0.0
        
        # Exact match
        if query_lower in content:
            score += 10.0
        
        # Word matches
        query_words = query_lower.split()
        content_words = content.split()
        
        for word in query_words:
            if word in content_words:
                score += 5.0
        
        # Recency bonus (more recent = higher score)
        try:
            timestamp = datetime.fromisoformat(message["timestamp"])
            days_old = (datetime.now() - timestamp).days
            recency_bonus = max(0, 5.0 - (days_old * 0.1))
            score += recency_bonus
        except:
            pass
        
        return score
    
    # =============================================================================
    # ARCHIVAL STORAGE (Long-term structured data)
    # =============================================================================
    
    async def insert_archival(self, user_id: str, key: str, data: Any, metadata: Dict = None) -> bool:
        """Insert data into archival storage"""
        memory = self._get_user_memory(user_id)
        
        if metadata is None:
            metadata = {}
        
        memory["archival_storage"][key] = {
            "data": data,
            "stored": datetime.now().isoformat(),
            "metadata": metadata
        }
        
        await self._save_archival_storage(user_id)
        return True
    
    def search_archival(self, user_id: str, query: str) -> List[Dict]:
        """Search archival storage"""
        memory = self._get_user_memory(user_id)
        
        if not query or not isinstance(query, str):
            return []
        
        query_lower = query.lower()
        results = []
        
        for key, entry in memory["archival_storage"].items():
            # Search in key and data
            search_text = f"{key} {str(entry['data'])}".lower()
            
            if query_lower in search_text:
                results.append({
                    "key": key,
                    "data": entry["data"],
                    "metadata": entry["metadata"],
                    "stored": entry["stored"]
                })
        
        return results
    
    # =============================================================================
    # MEMORY PRESSURE & STATUS
    # =============================================================================
    
    def check_memory_pressure(self, user_id: str) -> Dict:
        """Check memory pressure and return status"""
        memory = self._get_user_memory(user_id)
        
        # Estimate token usage (rough approximation: 4 chars = 1 token)
        total_chars = 0
        
        # Count working context
        for entry in memory["working_context"].values():
            total_chars += len(str(entry["value"]))
        
        # Count FIFO queue
        for msg in memory["fifo_queue"]:
            total_chars += len(msg["content"])
        
        # Count recursive summary
        if memory["recursive_summary"]:
            total_chars += len(memory["recursive_summary"])
        
        estimated_tokens = total_chars // 4
        memory["context_token_count"] = estimated_tokens
        
        # Calculate pressure
        context_window = self.config["context_window_size"]
        usage_ratio = estimated_tokens / context_window
        threshold = self.config["memory_pressure_threshold"]
        
        warning = usage_ratio > threshold
        memory["memory_pressure_warning"] = warning
        
        return {
            "usage": round(usage_ratio * 100, 1),
            "estimated_tokens": estimated_tokens,
            "context_window": context_window,
            "warning": warning,
            "message": f"Memory usage at {round(usage_ratio * 100, 1)}% of context window" if warning else None
        }
    
    def get_status(self, user_id: str) -> MemoryStatus:
        """Get comprehensive memory status"""
        memory = self._get_user_memory(user_id)
        pressure = self.check_memory_pressure(user_id)
        
        return MemoryStatus(
            session_id=memory["current_session_id"],
            user_id=user_id,
            working_context_size=len(memory["working_context"]),
            fifo_queue_length=len(memory["fifo_queue"]),
            recall_storage_size=len(memory["recall_storage"]),
            archival_storage_size=len(memory["archival_storage"]),
            context_token_count=memory["context_token_count"],
            memory_pressure=pressure["usage"] / 100.0,
            last_save_time=memory["last_save_time"]
        )
    
    # =============================================================================
    # PERSISTENCE
    # =============================================================================
    
    async def _save_working_context(self, user_id: str):
        """Save working context to disk"""
        memory = self._get_user_memory(user_id)
        file_path = self.config["data_dir"] / f"{user_id}_working_context.json"
        
        async with aiofiles.open(file_path, 'w') as f:
            await f.write(json.dumps(memory["working_context"], indent=2))
        
        memory["last_save_time"] = datetime.now().isoformat()
    
    async def _save_recall_storage(self, user_id: str):
        """Save recall storage to disk"""
        memory = self._get_user_memory(user_id)
        file_path = self.config["data_dir"] / f"{user_id}_recall_storage.jsonl"
        
        async with aiofiles.open(file_path, 'w') as f:
            for message in memory["recall_storage"]:
                await f.write(json.dumps(message) + '\n')
    
    async def _save_archival_storage(self, user_id: str):
        """Save archival storage to disk"""
        memory = self._get_user_memory(user_id)
        file_path = self.config["data_dir"] / f"{user_id}_archival_storage.json"
        
        async with aiofiles.open(file_path, 'w') as f:
            await f.write(json.dumps(memory["archival_storage"], indent=2))
    
    async def _load_global_state(self):
        """Load any existing global state"""
        # This can be extended to load user data on demand
        logger.info("Global state loading complete")
    
    async def cleanup(self):
        """Cleanup and save all user data"""
        logger.info("Saving all user memory data...")
        
        for user_id in self.user_memories.keys():
            try:
                await self._save_working_context(user_id)
                await self._save_recall_storage(user_id)
                await self._save_archival_storage(user_id)
            except Exception as e:
                logger.error(f"Error saving data for user {user_id}: {e}")
        
        logger.info("✅ Memory cleanup complete")
