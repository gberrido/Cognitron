# Multi-Model Support Design for Cognitron06

## Model Configuration System

### Current Models Support:
- ✅ openai/gpt-oss-120b - Original, reasoning-focused
- ✅ qwen/qwen3-32b - Efficient, strong agent capabilities  
- ✅ moonshotai/kimi-k2-instruct - Advanced tool use, agentic

### Configuration Structure:

```python
MODEL_CONFIGS = {
    "openai/gpt-oss-120b": {
        "model_name": "openai/gpt-oss-120b",
        "display_name": "GPT-OSS 120B (Reasoning)",
        "description": "120B parameter model with advanced reasoning capabilities",
        "default_params": {
            "temperature": 1.0,
            "max_completion_tokens": 8192,
            "top_p": 1.0,
            "reasoning_effort": "medium"  # unique to this model
        },
        "capabilities": {
            "tool_calling": True,
            "reasoning_effort": True,
            "max_context": 32768,
            "streaming": True
        },
        "optimal_use_cases": ["complex reasoning", "analysis", "problem solving"]
    },
    "qwen/qwen3-32b": {
        "model_name": "qwen/qwen3-32b", 
        "display_name": "Qwen3 32B (Efficient)",
        "description": "32B parameter model optimized for efficiency and agent tasks",
        "default_params": {
            "temperature": 0.6,
            "max_completion_tokens": 4096,
            "top_p": 0.95,
            "reasoning_effort": "default"
        },
        "capabilities": {
            "tool_calling": True,
            "reasoning_effort": True,
            "max_context": 16384,
            "streaming": True
        },
        "optimal_use_cases": ["efficient responses", "agent tasks", "general chat"]
    },
    "moonshotai/kimi-k2-instruct": {
        "model_name": "moonshotai/kimi-k2-instruct",
        "display_name": "Kimi K2 (Agentic)",
        "description": "Specialized model for advanced tool use and agentic workflows",
        "default_params": {
            "temperature": 0.6,
            "max_completion_tokens": 4096,
            "top_p": 1.0
            # Note: no reasoning_effort parameter
        },
        "capabilities": {
            "tool_calling": True,
            "reasoning_effort": False,
            "max_context": 16384,
            "streaming": True
        },
        "optimal_use_cases": ["tool usage", "agentic workflows", "function calling"]
    }
}
```

### Implementation Plan:

1. **Configuration System**: Add model config to ChatAgent
2. **Dynamic Parameter Selection**: Choose optimal params per model
3. **UI/CLI Model Selection**: Allow users to switch models
4. **Capability Detection**: Handle model-specific features gracefully
5. **Performance Monitoring**: Track which models work best for different tasks

### Tool Calling Compatibility:

**✅ CONFIRMED**: All models use identical tool calling interface:
```python
# Same tools array works for all models
tools = [
    {
        "type": "function", 
        "function": {
            "name": "core_memory_append",
            "description": "...",
            "parameters": { ... }
        }
    }
]

# Only API parameters differ per model
groq.chat.completions.create(
    model=config["model_name"],  # Different model
    **config["default_params"],  # Different optimal params
    tools=tools,                 # Same tools!
    tool_choice="auto"
)
```

### Benefits:
- ✅ **Cost Optimization**: Use efficient models for simple tasks
- ✅ **Performance Tuning**: Match model strengths to use cases  
- ✅ **User Choice**: Let users prefer different model characteristics
- ✅ **Future Extensibility**: Easy to add new Groq models
- ✅ **Backward Compatibility**: Existing functionality unchanged

## Implementation Steps:
1. Add ModelConfig class to core/
2. Update ChatAgent to accept model parameter
3. Add model selection to API endpoints
4. Update CLI client with model options
5. Add model switching commands (/model, /models)