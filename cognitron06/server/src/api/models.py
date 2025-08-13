#!/usr/bin/env python3
"""
Model management API endpoints for Cognitron06 Server
"""

import logging
from typing import Dict, List, Any
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel
from ..api.auth import get_current_user
from ..core.model_config import ModelConfigManager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Models"])


class ModelSwitchRequest(BaseModel):
    """Request model for switching models"""
    model: str


class ModelInfoResponse(BaseModel):
    """Response model for model information"""
    model: str
    display_name: str
    description: str
    optimal_use_cases: List[str]
    capabilities: Dict[str, Any]
    default_params: Dict[str, Any]


class AvailableModelsResponse(BaseModel):
    """Response model for available models list"""
    available_models: List[ModelInfoResponse]
    current_model: str
    default_model: str


def get_chat_agent():
    """Dependency to get chat agent from app state"""
    from ..main import app
    return app.state.chat_agent


@router.get("/available", response_model=AvailableModelsResponse)
async def get_available_models(
    current_user: dict = Depends(get_current_user),
    chat_agent = Depends(get_chat_agent)
):
    """Get list of all available models"""
    try:
        available_models = chat_agent.list_available_models()
        current_model = chat_agent.get_current_model()
        
        # Convert to response format (array of models with model name included)
        models_response = []
        for model_name, model_info in available_models.items():
            # The model_info already contains the model field, so just use it directly
            model_response = ModelInfoResponse(**model_info)
            models_response.append(model_response)
        
        return AvailableModelsResponse(
            available_models=models_response,
            current_model=current_model,
            default_model=ModelConfigManager.DEFAULT_MODEL
        )
    except Exception as e:
        logger.error(f"Error getting available models: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get available models: {str(e)}"
        )


@router.get("/current", response_model=ModelInfoResponse)
async def get_current_model(
    current_user: dict = Depends(get_current_user),
    chat_agent = Depends(get_chat_agent)
):
    """Get current model information"""
    try:
        current_model = chat_agent.get_current_model()
        model_info = chat_agent.get_model_info()
        
        return ModelInfoResponse(**model_info)
    except Exception as e:
        logger.error(f"Error getting current model: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get current model: {str(e)}"
        )


@router.post("/switch")
async def switch_model(
    request: ModelSwitchRequest,
    current_user: dict = Depends(get_current_user),
    chat_agent = Depends(get_chat_agent)
):
    """Switch to a different model"""
    try:
        # Validate model exists
        if not ModelConfigManager.is_valid_model(request.model):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid model: {request.model}. Available models: {list(ModelConfigManager.get_model_names())}"
            )
        
        # Attempt to switch model
        success = chat_agent.switch_model(request.model)
        
        if success:
            new_model_info = chat_agent.get_model_info()
            return {
                "message": f"Successfully switched to {request.model}",
                "previous_model": chat_agent.get_current_model() if not success else None,
                "current_model": request.model,
                "model_info": new_model_info
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to switch to model: {request.model}"
            )
    except HTTPException:
        # Re-raise HTTP exceptions without modification
        raise
    except Exception as e:
        logger.error(f"Error switching model: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to switch model: {str(e)}"
        )


@router.get("/info/{model_name}", response_model=ModelInfoResponse)
async def get_model_info(
    model_name: str,
    current_user: dict = Depends(get_current_user)
):
    """Get information about a specific model"""
    try:
        if not ModelConfigManager.is_valid_model(model_name):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Model not found: {model_name}"
            )
        
        model_info = ModelConfigManager.get_model_summary(model_name)
        
        return ModelInfoResponse(**model_info)
    except HTTPException:
        # Re-raise HTTP exceptions without modification
        raise
    except Exception as e:
        logger.error(f"Error getting model info for {model_name}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get model info: {str(e)}"
        )


@router.get("/capabilities/{model_name}")
async def get_model_capabilities(
    model_name: str,
    current_user: dict = Depends(get_current_user)
):
    """Get detailed capabilities for a specific model"""
    try:
        if not ModelConfigManager.is_valid_model(model_name):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Model not found: {model_name}"
            )
        
        model_config = ModelConfigManager.get_model_config(model_name)
        
        return {
            "model": model_name,
            "capabilities": {
                "tool_calling": model_config.capabilities.tool_calling,
                "reasoning_effort": model_config.capabilities.reasoning_effort,
                "streaming": model_config.capabilities.streaming,
                "max_context": model_config.capabilities.max_context
            },
            "optimal_params": model_config.default_params,
            "optimal_use_cases": model_config.optimal_use_cases
        }
    except HTTPException:
        # Re-raise HTTP exceptions without modification
        raise
    except Exception as e:
        logger.error(f"Error getting model capabilities for {model_name}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get model capabilities: {str(e)}"
        )


@router.post("/reset")
async def reset_to_default_model(
    current_user: dict = Depends(get_current_user),
    chat_agent = Depends(get_chat_agent)
):
    """Reset to the default model"""
    try:
        default_model = ModelConfigManager.DEFAULT_MODEL
        current_model = chat_agent.get_current_model()
        
        if current_model == default_model:
            return {
                "message": f"Already using default model: {default_model}",
                "current_model": current_model
            }
        
        success = chat_agent.switch_model(default_model)
        
        if success:
            return {
                "message": f"Reset to default model: {default_model}",
                "previous_model": current_model,
                "current_model": default_model
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to reset to default model: {default_model}"
            )
    except HTTPException:
        # Re-raise HTTP exceptions without modification
        raise
    except Exception as e:
        logger.error(f"Error resetting to default model: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reset to default model: {str(e)}"
        )