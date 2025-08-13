#!/usr/bin/env python3
"""
Chat API endpoints for Cognitron06 Server
"""

import logging
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.responses import StreamingResponse
from ..models.chat_models import ChatRequest, ChatResponse, StreamingChatResponse, ErrorResponse
from ..api.auth import get_current_user
from ..core.chat_agent import ChatAgent
from ..core.memory_system import MemGPTMemorySystem

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Chat"])


def get_memory_system() -> MemGPTMemorySystem:
    """Dependency to get memory system"""
    from ..main import app
    return app.state.memory_system


def get_chat_agent() -> ChatAgent:
    """Dependency to get chat agent"""
    from ..main import app
    return app.state.chat_agent


@router.post("/message", response_model=ChatResponse)
async def send_message(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user),
    chat_agent: ChatAgent = Depends(get_chat_agent),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system)
):
    """Send a message and get response"""
    user_id = current_user["username"]
    
    logger.info(f"Chat message from user {user_id}: {request.message[:100]}...")
    
    try:
        # Generate response with optional parameters
        response = await chat_agent.generate_response(
            user_id=user_id,
            message=request.message,
            temperature=request.temperature,
            max_tokens=request.max_tokens
        )
        
        if "error" in response:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=response["error"]
            )
        
        # Get current session info
        session_id = memory_system.get_current_session_id(user_id) or "unknown"
        
        return ChatResponse(
            content=response["content"],
            tool_calls=response["tool_calls"],
            session_id=session_id,
            usage=response.get("usage"),
            model=response.get("model"),
            model_info=response.get("model_info")
        )
    
    except Exception as e:
        logger.error(f"Error processing chat message: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process message: {str(e)}"
        )


@router.post("/stream")
async def stream_message(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user),
    chat_agent: ChatAgent = Depends(get_chat_agent),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system)
):
    """Stream a message response"""
    user_id = current_user["username"]
    
    logger.info(f"Streaming chat message from user {user_id}: {request.message[:100]}...")
    
    async def generate_stream():
        try:
            # Update agent config if provided
            if request.temperature is not None or request.max_tokens is not None:
                config_updates = {}
                if request.temperature is not None:
                    config_updates["temperature"] = request.temperature
                if request.max_tokens is not None:
                    config_updates["max_tokens"] = request.max_tokens
                chat_agent.update_config(config_updates)
            
            # Get session info
            session_id = memory_system.get_current_session_id(user_id) or "unknown"
            
            # Generate streaming response
            async for chunk in chat_agent._generate_streaming_response(
                user_id=user_id,
                api_params={
                    "model": chat_agent.config["model"],
                    "messages": chat_agent.get_conversation_context(user_id),
                    "temperature": chat_agent.config["temperature"],
                    "max_tokens": chat_agent.config["max_tokens"]
                }
            ):
                # Extract content from chunk dictionary
                if chunk.get("type") == "content_chunk":
                    content = chunk.get("content", "")
                    response = StreamingChatResponse(
                        content=content,
                        session_id=session_id,
                        is_complete=False
                    )
                    yield f"data: {response.json()}\n\n"
            
            # Send completion marker
            final_response = StreamingChatResponse(
                content="",
                session_id=session_id,
                is_complete=True
            )
            yield f"data: {final_response.json()}\n\n"
        
        except Exception as e:
            logger.error(f"Error in streaming response: {e}")
            error_response = ErrorResponse(
                error="Streaming failed",
                detail=str(e)
            )
            yield f"data: {error_response.json()}\n\n"
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/history")
async def get_chat_history(
    current_user: dict = Depends(get_current_user),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system),
    limit: int = 50,
    session_id: str = None
):
    """Get chat history for the current user"""
    user_id = current_user["username"]
    
    try:
        memory = memory_system._get_user_memory(user_id)
        messages = memory["recall_storage"]
        
        # Filter by session if specified
        if session_id:
            messages = [msg for msg in messages if msg.get("session_id") == session_id]
        
        # Apply limit
        messages = messages[-limit:] if len(messages) > limit else messages
        
        return {
            "messages": messages,
            "total_count": len(messages),
            "session_id": memory_system.get_current_session_id(user_id)
        }
    
    except Exception as e:
        logger.error(f"Error getting chat history: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get chat history: {str(e)}"
        )


@router.delete("/history")
async def clear_chat_history(
    current_user: dict = Depends(get_current_user),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system),
    session_id: str = None
):
    """Clear chat history"""
    user_id = current_user["username"]
    
    try:
        memory = memory_system._get_user_memory(user_id)
        
        if session_id:
            # Clear specific session
            memory["recall_storage"] = [
                msg for msg in memory["recall_storage"] 
                if msg.get("session_id") != session_id
            ]
            # Also clear from FIFO if it's current session
            if session_id == memory["current_session_id"]:
                memory["fifo_queue"] = []
        else:
            # Clear all history
            memory["recall_storage"] = []
            memory["fifo_queue"] = []
            memory["recursive_summary"] = ""
        
        # Save changes
        await memory_system._save_recall_storage(user_id)
        
        return {
            "message": "Chat history cleared successfully",
            "session_id": session_id or "all"
        }
    
    except Exception as e:
        logger.error(f"Error clearing chat history: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to clear chat history: {str(e)}"
        )
