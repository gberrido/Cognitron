#!/usr/bin/env python3
"""
Pydantic models for chat API endpoints
"""

from typing import Dict, List, Any, Optional
from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """Represents a chat message"""
    role: str = Field(..., description="Message role: 'user', 'assistant', or 'system'")
    content: str = Field(..., description="Message content")
    timestamp: Optional[str] = None
    session_id: Optional[str] = None


class ChatRequest(BaseModel):
    """Chat request model"""
    message: str = Field(..., description="User message")
    stream: bool = Field(default=False, description="Enable streaming response")
    session_id: Optional[str] = Field(None, description="Session ID for context")
    temperature: Optional[float] = Field(None, ge=0, le=2, description="Temperature for generation")
    max_tokens: Optional[int] = Field(None, gt=0, description="Maximum tokens to generate")


class ToolCall(BaseModel):
    """Tool call result"""
    tool_call_id: str
    function_name: str
    result: Dict[str, Any]


class ChatResponse(BaseModel):
    """Chat response model"""
    content: Optional[str] = Field(None, description="Assistant response content")
    tool_calls: List[ToolCall] = Field(default_factory=list, description="Tool calls executed")
    session_id: str = Field(..., description="Session ID")
    message_id: Optional[str] = Field(None, description="Unique message ID")
    usage: Optional[Dict[str, int]] = Field(None, description="Token usage information")
    model: Optional[str] = Field(None, description="Model used for response")
    model_info: Optional[Dict[str, Any]] = Field(None, description="Model information and capabilities")


class StreamingChatResponse(BaseModel):
    """Streaming chat response model"""
    content: str = Field(..., description="Partial content chunk")
    session_id: str = Field(..., description="Session ID")
    is_complete: bool = Field(default=False, description="Whether streaming is complete")


class ErrorResponse(BaseModel):
    """Error response model"""
    error: str = Field(..., description="Error message")
    detail: Optional[str] = Field(None, description="Error details")
    code: Optional[str] = Field(None, description="Error code")