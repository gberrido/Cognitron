#\!/usr/bin/env python3
"""
Model configuration system for Cognitron06
Supports multiple Groq-hosted models with optimized parameters
"""

from typing import Dict, Any, List, Optional
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)

@dataclass
class ModelCapabilities:
    """Model capability flags"""
    tool_calling: bool = True
    reasoning_effort: bool = False
    streaming: bool = True
    max_context: int = 16384
    supports_system_messages: bool = True

@dataclass 
class ModelConfig:
    """Configuration for a specific model"""
    model_name: str
    display_name: str
    description: str
    default_params: Dict[str, Any]
    capabilities: ModelCapabilities
    optimal_use_cases: List[str]
    cost_tier: str = "standard"  # low, standard, premium
    speed_tier: str = "standard"  # fast, standard, slow

class ModelConfigManager:
    """Manages available models and their configurations"""
    
    # Available model configurations
    MODELS = {
        "openai/gpt-oss-120b": ModelConfig(
            model_name="openai/gpt-oss-120b",
            display_name="GPT-OSS 120B (Reasoning)",
            description="120B parameter model with advanced reasoning capabilities",
            default_params={
                "temperature": 1.0,
                "max_tokens": 8192,
                "top_p": 1.0,
                "stream": False,
                "stop": None
                # Temporarily removing reasoning_effort to test
            },
            capabilities=ModelCapabilities(
                tool_calling=True,
                reasoning_effort=True,
                streaming=True,
                max_context=32768,
                supports_system_messages=True
            ),
            optimal_use_cases=["complex reasoning", "analysis", "problem solving", "research"],
            cost_tier="premium",
            speed_tier="standard"
        ),
        
        "qwen/qwen3-32b": ModelConfig(
            model_name="qwen/qwen3-32b",
            display_name="Qwen3 32B (Efficient)", 
            description="32B parameter model optimized for efficiency and agent tasks",
            default_params={
                "temperature": 0.6,
                "max_tokens": 4096,
                "top_p": 0.95,
                "stream": False,
                "stop": None
                # Temporarily removing reasoning_effort to test
            },
            capabilities=ModelCapabilities(
                tool_calling=True,
                reasoning_effort=True,
                streaming=True,
                max_context=16384,
                supports_system_messages=True
            ),
            optimal_use_cases=["efficient responses", "agent tasks", "general chat", "tool usage"],
            cost_tier="standard",
            speed_tier="fast"
        ),
        
        "moonshotai/kimi-k2-instruct": ModelConfig(
            model_name="moonshotai/kimi-k2-instruct",
            display_name="Kimi K2 (Agentic)",
            description="Specialized model for advanced tool use and agentic workflows",
            default_params={
                "temperature": 0.6,
                "max_tokens": 4096,
                "top_p": 1.0,
                "stream": False,
                "stop": None
                # Note: no reasoning_effort parameter for this model
            },
            capabilities=ModelCapabilities(
                tool_calling=True,
                reasoning_effort=False,  # This model doesn't support reasoning_effort
                streaming=True,
                max_context=16384,
                supports_system_messages=True
            ),
            optimal_use_cases=["tool usage", "agentic workflows", "function calling", "automation"],
            cost_tier="standard",
            speed_tier="fast"
        )
    }
    
    # Default model
    DEFAULT_MODEL = "openai/gpt-oss-120b"
    
    @classmethod
    def get_model_config(cls, model_name: str) -> Optional[ModelConfig]:
        """Get configuration for a specific model"""
        return cls.MODELS.get(model_name)
    
    @classmethod
    def get_default_config(cls) -> ModelConfig:
        """Get the default model configuration"""
        return cls.MODELS[cls.DEFAULT_MODEL]
    
    @classmethod
    def list_models(cls) -> Dict[str, ModelConfig]:
        """Get all available models"""
        return cls.MODELS.copy()
    
    @classmethod
    def get_model_names(cls) -> List[str]:
        """Get list of available model names"""
        return list(cls.MODELS.keys())
    
    @classmethod
    def is_valid_model(cls, model_name: str) -> bool:
        """Check if model name is valid"""
        return model_name in cls.MODELS
    
    @classmethod
    def get_models_by_use_case(cls, use_case: str) -> List[str]:
        """Get models suitable for a specific use case"""
        suitable_models = []
        for model_name, config in cls.MODELS.items():
            if use_case.lower() in [uc.lower() for uc in config.optimal_use_cases]:
                suitable_models.append(model_name)
        return suitable_models
    
    @classmethod
    def get_models_by_cost_tier(cls, cost_tier: str) -> List[str]:
        """Get models in a specific cost tier"""
        return [
            model_name for model_name, config in cls.MODELS.items()
            if config.cost_tier == cost_tier
        ]
    
    @classmethod
    def get_model_summary(cls, model_name: str) -> Dict[str, Any]:
        """Get a summary of model information for API responses"""
        config = cls.get_model_config(model_name)
        if not config:
            return None
            
        return {
            "model": config.model_name,
            "display_name": config.display_name,
            "description": config.description,
            "capabilities": {
                "tool_calling": config.capabilities.tool_calling,
                "reasoning_effort": config.capabilities.reasoning_effort,
                "streaming": config.capabilities.streaming,
                "max_context": config.capabilities.max_context
            },
            "default_params": config.default_params,
            "optimal_use_cases": config.optimal_use_cases,
            "cost_tier": config.cost_tier,
            "speed_tier": config.speed_tier
        }
    
    @classmethod
    def prepare_api_params(cls, model_name: str, override_params: Dict[str, Any] = None) -> Dict[str, Any]:
        """Prepare API parameters for a model, with optional overrides"""
        config = cls.get_model_config(model_name)
        if not config:
            raise ValueError(f"Unknown model: {model_name}")
        
        # Start with model defaults
        params = config.default_params.copy()
        
        # Add model name
        params["model"] = model_name
        
        # Apply overrides if provided
        if override_params:
            # Handle special case: remove reasoning_effort if model doesn't support it
            if not config.capabilities.reasoning_effort and "reasoning_effort" in override_params:
                logger.warning(f"Model {model_name} doesn't support reasoning_effort, removing parameter")
                override_params = override_params.copy()
                del override_params["reasoning_effort"]
            
            params.update(override_params)
        
        # Remove reasoning_effort if model doesn't support it (safety check)
        if not config.capabilities.reasoning_effort and "reasoning_effort" in params:
            del params["reasoning_effort"]
            
        return params

# Convenience function for backward compatibility
def get_model_config(model_name: str = None) -> ModelConfig:
    """Get model configuration (defaults to current default model)"""
    if model_name is None:
        return ModelConfigManager.get_default_config()
    return ModelConfigManager.get_model_config(model_name)
