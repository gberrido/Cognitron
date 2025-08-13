# 🐳 Force Rebuild Docker Server Instructions

## Problem Identified
The Docker server is running **old code** that returns `{ models: {} }` instead of the updated `{ available_models: [] }` format.

## Live Server Test Results
```bash
❌ Response format is incorrect!
   available_models: undefined
   Is array: false
   Found "models" field instead of "available_models"
   This means the server fix was not applied!
```

## Required Actions

### 1. Stop Current Container
```bash
cd /path/to/cognitron06
docker-compose down
```

### 2. Force Rebuild with No Cache
```bash
# Rebuild the server container from scratch
docker-compose build --no-cache cognitron06-server

# Alternative: Rebuild everything
docker-compose build --no-cache
```

### 3. Restart Services
```bash
# Start with fresh container
docker-compose up -d

# Or start in foreground to see logs
docker-compose up
```

### 4. Verify the Fix
```bash
# Test the updated API endpoint
node test-live-server-models.js
```

## Expected Results After Rebuild

The server should return:
```json
{
  "available_models": [
    {
      "model": "openai/gpt-oss-120b",
      "display_name": "GPT-OSS 120B (Reasoning)",
      "description": "120B parameter model with advanced reasoning capabilities",
      "optimal_use_cases": ["complex reasoning", "analysis", "problem solving", "research"]
    },
    {
      "model": "qwen/qwen3-32b", 
      "display_name": "Qwen3 32B (Efficient)",
      "description": "32B parameter model optimized for efficiency and agent tasks",
      "optimal_use_cases": ["efficient responses", "agent tasks", "general chat", "tool usage"]
    },
    {
      "model": "moonshotai/kimi-k2-instruct",
      "display_name": "Kimi K2 (Agentic)", 
      "description": "Specialized model for advanced tool use and agentic workflows",
      "optimal_use_cases": ["tool usage", "agentic workflows", "function calling", "automation"]
    }
  ],
  "current_model": "openai/gpt-oss-120b",
  "default_model": "openai/gpt-oss-120b"
}
```

## CLI Test After Rebuild

```bash
node cognitron-sdk.js chat
> /models
```

Should show:
```
🤖 Available Models:
──────────────────────────────────────────────────
● GPT-OSS 120B (Reasoning)
   120B parameter model with advanced reasoning capabilities
   Optimal for: complex reasoning, analysis, problem solving, research

○ Qwen3 32B (Efficient)
   32B parameter model optimized for efficiency and agent tasks  
   Optimal for: efficient responses, agent tasks, general chat, tool usage

○ Kimi K2 (Agentic)
   Specialized model for advanced tool use and agentic workflows
   Optimal for: tool usage, agentic workflows, function calling, automation
```

## Why This Happened
- We updated the server code in `models.py`
- But the Docker container was still running the old image
- Docker containers need explicit rebuilds when code changes
- The volume mount (`./server/src:/app/src:ro`) helps with live reloading but doesn't update the Python environment

## Key Lesson
**Always force rebuild Docker containers after server code changes:**
```bash
docker-compose build --no-cache
docker-compose up -d
```