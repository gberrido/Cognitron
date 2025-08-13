#!/usr/bin/env python3
"""
Pydantic models for memory API endpoints
"""

from typing import Dict, List, Any, Optional
from pydantic import BaseModel, Field


class MemoryStatus(BaseModel):
    """Memory status model"""
    session_id: str = Field(..., description="Current session ID")
    user_id: str = Field(..., description="User ID")
    working_context_size: int = Field(..., description="Number of working context entries")
    fifo_queue_length: int = Field(..., description="Number of messages in FIFO queue")
    recall_storage_size: int = Field(..., description="Total number of stored messages")
    archival_storage_size: int = Field(..., description="Number of archival entries")
    context_token_count: int = Field(..., description="Estimated token count")
    memory_pressure: float = Field(..., description="Memory pressure ratio (0-1)")
    last_save_time: str = Field(..., description="Last save timestamp")


class WorkingContextEntry(BaseModel):
    """Working context entry model"""
    key: str = Field(..., description="Context key")
    value: str = Field(..., description="Context value")
    last_updated: str = Field(..., description="Last update timestamp")
    update_count: int = Field(..., description="Number of updates")


class WorkingContextRequest(BaseModel):
    """Working context update request"""
    key: str = Field(..., description="Context key")
    value: str = Field(..., description="Context value")


class SearchRequest(BaseModel):
    """Memory search request"""
    query: str = Field(..., description="Search query")
    max_results: int = Field(default=10, ge=1, le=50, description="Maximum results")
    session_filter: Optional[str] = Field(None, description="Filter by session ID")


class SearchResult(BaseModel):
    """Memory search result"""
    id: str = Field(..., description="Message ID")
    timestamp: str = Field(..., description="Message timestamp")
    session_id: str = Field(..., description="Session ID")
    role: str = Field(..., description="Message role")
    content: str = Field(..., description="Message content")
    relevance_score: float = Field(..., description="Relevance score")


class SearchResponse(BaseModel):
    """Memory search response"""
    query: str = Field(..., description="Search query")
    results: List[SearchResult] = Field(..., description="Search results")
    total_count: int = Field(..., description="Total number of results")


class ArchivalInsertRequest(BaseModel):
    """Archival memory insert request"""
    key: str = Field(..., description="Data key")
    data: str = Field(..., description="Data to store")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Optional metadata")


class ArchivalSearchResult(BaseModel):
    """Archival search result"""
    key: str = Field(..., description="Data key")
    data: Any = Field(..., description="Stored data")
    stored: str = Field(..., description="Storage timestamp")
    metadata: Dict[str, Any] = Field(..., description="Metadata")


class ArchivalSearchResponse(BaseModel):
    """Archival search response"""
    query: str = Field(..., description="Search query")
    results: List[ArchivalSearchResult] = Field(..., description="Search results")
    total_count: int = Field(..., description="Total number of results")


class MemoryPressureInfo(BaseModel):
    """Memory pressure information"""
    usage: float = Field(..., description="Memory usage percentage")
    estimated_tokens: int = Field(..., description="Estimated token count")
    context_window: int = Field(..., description="Context window size")
    warning: bool = Field(..., description="Whether pressure warning is active")
    message: Optional[str] = Field(None, description="Warning message")