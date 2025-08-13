#!/usr/bin/env python3
"""
Health check and system status endpoints
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Depends
from ..services.session_manager import SessionManager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Health"])


def get_session_manager() -> SessionManager:
    """Dependency to get session manager"""
    from ..main import app
    return app.state.session_manager


def get_memory_system():
    """Dependency to get memory system"""
    from ..main import app
    return app.state.memory_system


def get_chat_agent():
    """Dependency to get chat agent"""
    from ..main import app
    return app.state.chat_agent


@router.get("/health")
async def health_check():
    """Basic health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "cognitron06-server"
    }


@router.get("/status")
async def system_status(
    session_manager: SessionManager = Depends(get_session_manager),
    memory_system = Depends(get_memory_system),
    chat_agent = Depends(get_chat_agent)
):
    """Comprehensive system status"""
    # Clean up expired sessions
    session_manager.cleanup_expired_sessions()
    
    return {
        "status": "operational",
        "timestamp": datetime.now().isoformat(),
        "services": {
            "memory_system": "operational" if memory_system else "unavailable",
            "chat_agent": "operational" if chat_agent else "unavailable",
            "session_manager": "operational"
        },
        "statistics": {
            "active_sessions": session_manager.get_active_sessions_count(),
            "total_sessions": len(session_manager.active_sessions)
        },
        "version": "1.0.0"
    }


@router.get("/ping")
async def ping():
    """Simple ping endpoint"""
    return {"message": "pong"}