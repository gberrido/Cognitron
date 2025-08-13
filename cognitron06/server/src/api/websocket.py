#!/usr/bin/env python3
"""
WebSocket endpoints for real-time chat streaming
"""

import json
import logging
from typing import Dict, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from ..services.session_manager import SessionManager
from ..core.chat_agent import ChatAgent
from ..core.memory_system import MemGPTMemorySystem

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])


class ConnectionManager:
    """Manages WebSocket connections"""
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
    
    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.info(f"WebSocket connection established for user: {user_id}")
    
    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            logger.info(f"WebSocket connection closed for user: {user_id}")
    
    async def send_personal_message(self, message: str, user_id: str):
        if user_id in self.active_connections:
            await self.active_connections[user_id].send_text(message)
    
    async def send_json_message(self, data: Dict[str, Any], user_id: str):
        if user_id in self.active_connections:
            await self.active_connections[user_id].send_text(json.dumps(data))


# Global connection manager
manager = ConnectionManager()


def get_session_manager() -> SessionManager:
    """Dependency to get session manager"""
    from ..main import app
    return app.state.session_manager


def get_settings():
    """Dependency to get settings"""
    from ..main import app
    return app.state.settings


def get_memory_system() -> MemGPTMemorySystem:
    """Dependency to get memory system"""
    from ..main import app
    return app.state.memory_system


def get_chat_agent() -> ChatAgent:
    """Dependency to get chat agent"""
    from ..main import app
    return app.state.chat_agent


async def authenticate_websocket(
    websocket: WebSocket,
    token: str,
    session_manager: SessionManager,
    settings
) -> str:
    """Authenticate WebSocket connection"""
    session_info = session_manager.validate_session(token, settings.secret_key, settings.algorithm)
    
    if not session_info:
        await websocket.close(code=4001, reason="Authentication failed")
        raise HTTPException(status_code=401, detail="Authentication failed")
    
    return session_info["username"]


@router.websocket("/chat")
async def websocket_chat_endpoint(
    websocket: WebSocket,
    token: str,
    session_manager: SessionManager = Depends(get_session_manager),
    settings = Depends(get_settings),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system),
    chat_agent: ChatAgent = Depends(get_chat_agent)
):
    """WebSocket endpoint for real-time chat"""
    
    try:
        # Authenticate user
        user_id = await authenticate_websocket(websocket, token, session_manager, settings)
        
        # Connect to WebSocket
        await manager.connect(websocket, user_id)
        
        # Send welcome message
        await manager.send_json_message({
            "type": "system",
            "message": "Connected to Cognitron06 chat",
            "user_id": user_id,
            "timestamp": memory_system.get_current_session_id(user_id)
        }, user_id)
        
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            
            try:
                message_data = json.loads(data)
                message_type = message_data.get("type", "chat")
                
                if message_type == "chat":
                    await handle_chat_message(
                        user_id, message_data, chat_agent, memory_system
                    )
                elif message_type == "ping":
                    await manager.send_json_message({
                        "type": "pong",
                        "timestamp": message_data.get("timestamp")
                    }, user_id)
                elif message_type == "config":
                    await handle_config_update(
                        user_id, message_data, chat_agent
                    )
                else:
                    await manager.send_json_message({
                        "type": "error",
                        "message": f"Unknown message type: {message_type}"
                    }, user_id)
            
            except json.JSONDecodeError:
                await manager.send_json_message({
                    "type": "error",
                    "message": "Invalid JSON format"
                }, user_id)
            except Exception as e:
                logger.error(f"Error processing WebSocket message: {e}")
                await manager.send_json_message({
                    "type": "error",
                    "message": f"Error processing message: {str(e)}"
                }, user_id)
    
    except WebSocketDisconnect:
        manager.disconnect(user_id)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(user_id)


async def handle_chat_message(
    user_id: str,
    message_data: Dict[str, Any],
    chat_agent: ChatAgent,
    memory_system: MemGPTMemorySystem
):
    """Handle chat message from WebSocket"""
    user_message = message_data.get("message", "")
    stream = message_data.get("stream", True)
    
    if not user_message.strip():
        await manager.send_json_message({
            "type": "error",
            "message": "Empty message"
        }, user_id)
        return
    
    logger.info(f"WebSocket chat message from {user_id}: {user_message[:100]}...")
    
    try:
        # Send typing indicator
        await manager.send_json_message({
            "type": "typing",
            "status": "start"
        }, user_id)
        
        if stream:
            # Handle streaming response
            await handle_streaming_response(user_id, user_message, chat_agent, memory_system)
        else:
            # Handle complete response
            response = await chat_agent.generate_response(
                user_id=user_id,
                message=user_message,
                stream=False
            )
            
            if "error" in response:
                await manager.send_json_message({
                    "type": "error",
                    "message": response["error"]
                }, user_id)
            else:
                await manager.send_json_message({
                    "type": "response",
                    "content": response["content"],
                    "tool_calls": response["tool_calls"],
                    "usage": response.get("usage"),
                    "session_id": memory_system.get_current_session_id(user_id)
                }, user_id)
        
        # Send typing indicator end
        await manager.send_json_message({
            "type": "typing",
            "status": "end"
        }, user_id)
    
    except Exception as e:
        logger.error(f"Error in WebSocket chat handler: {e}")
        await manager.send_json_message({
            "type": "error",
            "message": f"Chat error: {str(e)}"
        }, user_id)


async def handle_streaming_response(
    user_id: str,
    user_message: str,
    chat_agent: ChatAgent,
    memory_system: MemGPTMemorySystem
):
    """Handle streaming chat response"""
    try:
        # Add user message to memory
        await memory_system.add_to_fifo_queue(user_id, "user", user_message)
        
        # Get conversation context
        messages = chat_agent.get_conversation_context(user_id)
        
        # Check if tools are available and model supports them
        has_tools = chat_agent.model_config.capabilities.tool_calling and chat_agent.tools
        
        if has_tools:
            # Try to use regular API call when tools are needed (Groq streaming + tools doesn't work well)
            logger.info("Tools detected, using regular API call instead of streaming")
            try:
                response = await chat_agent.generate_response(
                    user_id=user_id,
                    message=user_message,
                    stream=False
                )
                
                # Send the complete response
                if "error" in response:
                    await manager.send_json_message({
                        "type": "stream_error",
                        "message": response["error"]
                    }, user_id)
                else:
                    # Simulate streaming by sending the full response
                    if response.get("content"):
                        await manager.send_json_message({
                            "type": "stream_chunk",
                            "content": response["content"]
                        }, user_id)
                    
                    # Send tool calls if any
                    if response.get("tool_calls"):
                        for tool_call in response["tool_calls"]:
                            await manager.send_json_message({
                                "type": "tool_call",
                                "tool_call": tool_call
                            }, user_id)
                    
                    # Send stream end
                    await manager.send_json_message({
                        "type": "stream_end",
                        "full_content": response.get("content", "")
                    }, user_id)
                return
                
            except Exception as e:
                logger.error(f"Error with tool-enabled response: {e}")
                await manager.send_json_message({
                    "type": "stream_error",
                    "message": str(e)
                }, user_id)
                return
        
        # Use streaming for non-tool requests
        api_options = {
            "model": chat_agent.current_model,
            "messages": messages,
            "temperature": chat_agent.config["temperature"],
            "max_tokens": chat_agent.config["max_tokens"],
            "stream": True
        }
        
        logger.info(f"Using streaming without tools for better compatibility")
        
        # Remove None values
        api_options = {k: v for k, v in api_options.items() if v is not None}
        
        # Send stream start
        await manager.send_json_message({
            "type": "stream_start",
            "session_id": memory_system.get_current_session_id(user_id)
        }, user_id)
        
        full_response = ""
        
        # Stream response chunks
        async for chunk in chat_agent._generate_streaming_response(user_id, api_options):
            if chunk.get("type") == "content_chunk":
                content = chunk.get("content", "")
                full_response += content
                await manager.send_json_message({
                    "type": "stream_chunk",
                    "content": content
                }, user_id)
            elif chunk.get("type") == "tool_call":
                await manager.send_json_message({
                    "type": "tool_call",
                    "tool_call": chunk.get("tool_call")
                }, user_id)
        
        # Add complete response to memory
        if full_response.strip():
            await memory_system.add_to_fifo_queue(user_id, "assistant", full_response)
        
        # Send stream end
        await manager.send_json_message({
            "type": "stream_end",
            "full_content": full_response
        }, user_id)
    
    except Exception as e:
        logger.error(f"Error in streaming response: {e}")
        await manager.send_json_message({
            "type": "stream_error",
            "message": str(e)
        }, user_id)


async def handle_config_update(
    user_id: str,
    message_data: Dict[str, Any],
    chat_agent: ChatAgent
):
    """Handle configuration update"""
    try:
        config = message_data.get("config", {})
        chat_agent.update_config(config)
        
        await manager.send_json_message({
            "type": "config_updated",
            "config": config,
            "message": "Configuration updated successfully"
        }, user_id)
    
    except Exception as e:
        await manager.send_json_message({
            "type": "error",
            "message": f"Config update failed: {str(e)}"
        }, user_id)


@router.get("/connections")
async def get_active_connections():
    """Get active WebSocket connections (for monitoring)"""
    return {
        "active_connections": len(manager.active_connections),
        "connected_users": list(manager.active_connections.keys())
    }
