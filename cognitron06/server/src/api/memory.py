#!/usr/bin/env python3
"""
Memory API endpoints for Cognitron06 Server
"""

import logging
from typing import List
from fastapi import APIRouter, HTTPException, Depends, status
from ..models.memory_models import (
    MemoryStatus, WorkingContextEntry, WorkingContextRequest,
    SearchRequest, SearchResponse, SearchResult,
    ArchivalInsertRequest, ArchivalSearchResponse, ArchivalSearchResult,
    MemoryPressureInfo
)
from ..api.auth import get_current_user
from ..core.memory_system import MemGPTMemorySystem

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Memory"])


def get_memory_system() -> MemGPTMemorySystem:
    """Dependency to get memory system"""
    from ..main import app
    return app.state.memory_system


@router.get("/status", response_model=MemoryStatus)
async def get_memory_status(
    current_user: dict = Depends(get_current_user),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system)
):
    """Get comprehensive memory status"""
    user_id = current_user["username"]
    
    try:
        status = memory_system.get_status(user_id)
        return status
    except Exception as e:
        logger.error(f"Error getting memory status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get memory status: {str(e)}"
        )


@router.get("/pressure", response_model=MemoryPressureInfo)
async def get_memory_pressure(
    current_user: dict = Depends(get_current_user),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system)
):
    """Get memory pressure information"""
    user_id = current_user["username"]
    
    try:
        pressure = memory_system.check_memory_pressure(user_id)
        return MemoryPressureInfo(**pressure)
    except Exception as e:
        logger.error(f"Error getting memory pressure: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get memory pressure: {str(e)}"
        )


@router.get("/working-context", response_model=List[WorkingContextEntry])
async def get_working_context(
    current_user: dict = Depends(get_current_user),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system)
):
    """Get all working context entries"""
    user_id = current_user["username"]
    
    try:
        context = memory_system.get_working_context(user_id)
        
        entries = [
            WorkingContextEntry(
                key=key,
                value=data["value"],
                last_updated=data["last_updated"],
                update_count=data["update_count"]
            )
            for key, data in context.items()
        ]
        
        return entries
    except Exception as e:
        logger.error(f"Error getting working context: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get working context: {str(e)}"
        )


@router.post("/working-context")
async def update_working_context(
    request: WorkingContextRequest,
    current_user: dict = Depends(get_current_user),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system)
):
    """Update working context entry"""
    user_id = current_user["username"]
    
    try:
        success = await memory_system.update_working_context(
            user_id, request.key, request.value
        )
        
        if success:
            return {
                "message": f"Working context updated: {request.key}",
                "key": request.key,
                "value": request.value
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update working context"
            )
    except Exception as e:
        logger.error(f"Error updating working context: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update working context: {str(e)}"
        )


@router.delete("/working-context/{key}")
async def delete_working_context(
    key: str,
    current_user: dict = Depends(get_current_user),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system)
):
    """Delete working context entry"""
    user_id = current_user["username"]
    
    try:
        memory = memory_system._get_user_memory(user_id)
        
        if key in memory["working_context"]:
            del memory["working_context"][key]
            await memory_system._save_working_context(user_id)
            
            return {
                "message": f"Working context entry deleted: {key}",
                "key": key
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Working context entry not found: {key}"
            )
    except HTTPException:
        # Re-raise HTTP exceptions (like 404) without modification
        raise
    except Exception as e:
        logger.error(f"Error deleting working context: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete working context: {str(e)}"
        )


@router.post("/search", response_model=SearchResponse)
async def search_memory(
    request: SearchRequest,
    current_user: dict = Depends(get_current_user),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system)
):
    """Search conversation history"""
    user_id = current_user["username"]
    
    try:
        options = {
            "max_results": request.max_results,
            "session_filter": request.session_filter
        }
        
        results = memory_system.search_recall_storage(user_id, request.query, options)
        
        search_results = [
            SearchResult(
                id=result["id"],
                timestamp=result["timestamp"],
                session_id=result["session_id"],
                role=result["role"],
                content=result["content"],
                relevance_score=result["relevance_score"]
            )
            for result in results
        ]
        
        return SearchResponse(
            query=request.query,
            results=search_results,
            total_count=len(search_results)
        )
    except Exception as e:
        logger.error(f"Error searching memory: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to search memory: {str(e)}"
        )


@router.post("/archival")
async def insert_archival_memory(
    request: ArchivalInsertRequest,
    current_user: dict = Depends(get_current_user),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system)
):
    """Insert data into archival memory"""
    user_id = current_user["username"]
    
    try:
        success = await memory_system.insert_archival(
            user_id, request.key, request.data, request.metadata
        )
        
        if success:
            return {
                "message": f"Data stored in archival memory: {request.key}",
                "key": request.key,
                "data_preview": request.data[:100] + ("..." if len(request.data) > 100 else "")
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to store archival data"
            )
    except Exception as e:
        logger.error(f"Error inserting archival memory: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to insert archival memory: {str(e)}"
        )


@router.post("/archival/search", response_model=ArchivalSearchResponse)
async def search_archival_memory(
    request: SearchRequest,
    current_user: dict = Depends(get_current_user),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system)
):
    """Search archival memory"""
    user_id = current_user["username"]
    
    try:
        results = memory_system.search_archival(user_id, request.query)
        
        archival_results = [
            ArchivalSearchResult(
                key=result["key"],
                data=result["data"],
                stored=result["stored"],
                metadata=result["metadata"]
            )
            for result in results[:request.max_results]
        ]
        
        return ArchivalSearchResponse(
            query=request.query,
            results=archival_results,
            total_count=len(archival_results)
        )
    except Exception as e:
        logger.error(f"Error searching archival memory: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to search archival memory: {str(e)}"
        )


@router.get("/sessions")
async def list_sessions(
    current_user: dict = Depends(get_current_user),
    memory_system: MemGPTMemorySystem = Depends(get_memory_system)
):
    """List all user sessions"""
    user_id = current_user["username"]
    
    try:
        memory = memory_system._get_user_memory(user_id)
        messages = memory["recall_storage"]
        
        # Group messages by session
        sessions = {}
        for message in messages:
            session_id = message.get("session_id", "unknown")
            if session_id not in sessions:
                sessions[session_id] = {
                    "session_id": session_id,
                    "start_time": message["timestamp"],
                    "end_time": message["timestamp"],
                    "message_count": 0
                }
            
            sessions[session_id]["message_count"] += 1
            sessions[session_id]["end_time"] = message["timestamp"]
        
        # Sort by start time (most recent first)
        session_list = sorted(
            sessions.values(),
            key=lambda x: x["start_time"],
            reverse=True
        )
        
        return {
            "sessions": session_list,
            "total_sessions": len(session_list),
            "current_session": memory["current_session_id"]
        }
    except Exception as e:
        logger.error(f"Error listing sessions: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list sessions: {str(e)}"
        )