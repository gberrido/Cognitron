# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cognitron05 is a monolithic MemGPT-style AI assistant with persistent memory capabilities. It implements a self-contained educational version of the MemGPT architecture with autonomous tool calling, context window management, and persistent memory across sessions. The system supports multiple LLM providers (Groq, Together AI, Mock) and includes comprehensive memory management with recall search and archival storage.

## Development Commands

### Running the Application
```bash
# Interactive chat mode (default)
node cognitron05.js

# Chat mode explicitly
node cognitron05.js chat

# Single question mode
node cognitron05.js ask "your question here"

# Development mode with debugging
node cognitron05.js chat --reasoning high --show-usage --debug

# Check system status
node cognitron05.js status

# Reset all memory and start fresh
node cognitron05.js reset

# Test mode with mock provider (offline)
node cognitron05.js --test

# Custom provider selection
node cognitron05.js --provider groq
node cognitron05.js --provider together
node cognitron05.js --provider mock
```

### NPM Scripts
```bash
npm start          # node cognitron05.js
npm run chat       # node cognitron05.js chat  
npm run status     # node cognitron05.js status
npm run reset      # node cognitron05.js reset
npm run dev        # Development mode with full debugging
```

### Environment Setup
```bash
# Required for Groq provider
export GROQ_API_KEY="your-groq-api-key"

# Required for Together AI provider  
export TOGETHER_API_KEY="your-together-api-key"

# Optional: Enable debug logging
export DEBUG=true
```

## Architecture Overview

### Core Implementation

**Single File Architecture**: The entire system is implemented in `cognitron05.js` as an educational monolith. This design prioritizes learnability and traceability over modularity.

**Main Components**:
- `MemGPTCognitron` class - Core agent with memory management and tool execution
- `MockLLM` class - Offline testing provider that simulates MemGPT behaviors
- Memory persistence layer with file-based storage
- Multi-provider LLM support (Groq, Together AI, Mock)

### Memory Architecture

The system implements a four-tier memory architecture:

1. **Working Context** (Map) - Persistent key-value facts about the user stored in `working-context.json`
2. **Conversation Context** (Array) - FIFO message queue with automatic eviction when context window fills
3. **Recursive Summary** (String) - Compressed history created during memory pressure events
4. **Archival Storage** (Map) - Long-term document storage with TF-IDF search capabilities

### Data Persistence

All data is stored in the `cognitron-memgpt-data/` directory:
```
cognitron-memgpt-data/
├── working-context.json     # Persistent user facts (core memory)
├── session-state.json       # Session metadata and configuration
├── recall-storage.jsonl     # Complete conversation history (append-only)
├── recall-index.json        # TF-IDF search index for conversation search
├── archival-storage.json    # Document storage metadata
└── archival/
    ├── documents/           # Stored documents
    ├── embeddings.json      # Document embeddings (when available)
    └── metadata.json        # Document metadata
```

## MemGPT Tool System

The AI has autonomous access to these memory management tools:

### Core Memory Tools
- `core_memory_append(key, value)` - Store persistent facts about the user
- `core_memory_replace(key, new_value)` - Update existing core memories
- `get_memory_status()` - Check memory system statistics

### Conversation Tools
- `conversation_search(query, limit=10)` - Search past conversation history using TF-IDF
- `pause_heartbeats(message)` - Signal end of autonomous processing, respond to user

### Archival Memory Tools
- `archival_memory_insert(title, content)` - Store documents for long-term retrieval
- `archival_memory_search(query, limit=10)` - Search archived documents

## Interactive Commands

```bash
/help            # Show all available commands
/status          # Display provider status and memory statistics
/memory          # Show current working context (core memory)
/provider <name> # Switch LLM provider (groq|together|mock)
/recall <query>  # Search conversation history
/arch <query>    # Search archival documents
/stream          # Toggle streaming responses on/off
/think           # Toggle reasoning visibility in responses
/autosum         # Toggle automatic LLM-based summarization
/compact         # Force memory compaction (evict old messages)
/clear           # Clear conversation history but keep core memory
/reset           # Reset all memory (working context, conversation, archival)
/exit            # Save state and exit application
```

## Context Window Management

The system automatically manages the 8192 token context window:

- **Token Counting**: Uses 4-character approximation (text.length / 4)
- **Memory Pressure Warning**: Triggers at 70% context usage
- **Automatic Eviction**: Removes 50% of oldest messages at 100% usage
- **Summarization**: Creates compressed summaries of evicted conversations
- **Real-time Monitoring**: Displays token usage during conversations

Key configuration constants:
```javascript
maxContextWindow: 8192              // Model context limit
memoryPressureThreshold: 0.70       // Warning at 70%
evictionThreshold: 1.00             // Eviction at 100%
evictionPercentage: 0.50            // Remove 50% on eviction
```

## Provider Configuration

### Groq Provider
- Model: `openai/gpt-oss-120b` (approximately GPT-3.5 equivalent)
- Supports streaming responses
- Requires `GROQ_API_KEY` environment variable
- Primary production provider

### Together AI Provider  
- Model: `meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo`
- Supports streaming responses
- Requires `TOGETHER_API_KEY` environment variable
- Alternative production provider

### Mock Provider
- Offline testing provider with simulated MemGPT behaviors
- Recognizes user input patterns and responds with appropriate tool calls
- Used for development and demonstrations without API keys

## Tool Implementation Details

### Tool Calling Protocol
The system uses a text-based tool calling protocol since OpenAI-style function calling is not fully supported by all providers:

```
CALL tool_name {"param1": "value1", "param2": "value2"}
```

### Autonomous Processing Flow
1. User provides input
2. AI analyzes input and determines necessary tool calls
3. AI chains multiple tool calls as needed (autonomous phase)
4. AI calls `pause_heartbeats(message)` to signal completion
5. System displays response to user

### Example Tool Chain
```
User: "My name is Alice and I love Italian food"
→ AI: CALL core_memory_append {"key": "user_name", "value": "Alice"}
→ AI: CALL core_memory_append {"key": "food_preference", "value": "loves Italian food"}  
→ AI: CALL pause_heartbeats {"message": "Nice to meet you Alice! I've noted your name and food preferences."}
```

## Key Development Patterns

### Error Handling
- Provider failures gracefully fall back to mock provider
- File I/O errors use empty defaults with logging
- Tool call parsing handles malformed JSON with fallbacks
- Context overflow automatically triggers memory management

### Memory Persistence
- All memory operations are atomic with proper error recovery
- JSON files are read/written with UTF-8 encoding
- Append-only recall storage prevents data corruption
- TF-IDF indexes are rebuilt automatically when corrupted

### Provider Management
- Dynamic provider switching during runtime via `/provider` command
- Automatic fallback from failed providers to mock provider
- Streaming and non-streaming modes supported for all providers
- Model parameters (temperature, max_tokens) are provider-specific

## Testing and Validation

### Testing Philosophy
Use the built-in mock provider for testing MemGPT behaviors without requiring API keys:

```bash
# Test basic MemGPT functionality
node cognitron05.js --test

# Test provider switching
node cognitron05.js --provider mock

# Interactive testing scenarios
node cognitron05.js --provider mock
> My name is Bob, I'm a software engineer who likes coffee
# Watch for: core_memory_append calls followed by pause_heartbeats
```

### Key Behaviors to Validate
- **Autonomous Memory Storage**: AI should automatically store user facts in core memory
- **Context Window Management**: System should warn and evict messages near token limits
- **Tool Chaining**: AI should chain multiple tool calls before responding
- **Session Persistence**: Memory should restore correctly after restart
- **Search Functionality**: Recall and archival search should return relevant results

### Development Testing
```bash
# Test with debug output
DEBUG=true node cognitron05.js --provider mock

# Test memory pressure
node cognitron05.js --provider mock
> /clear
> [Paste very long text to trigger eviction]

# Test search functionality  
> /recall coffee
> /arch documents
```

## Critical Implementation Details

1. **Monolithic Design**: Single file for educational clarity - prioritizes understanding over modularity
2. **Text-based Tool Protocol**: Uses CALL/PAUSE pattern instead of OpenAI function calling for provider compatibility
3. **Automatic Memory Management**: Context window pressure handled transparently
4. **Multi-provider Support**: Runtime switching between Groq, Together AI, and Mock providers
5. **Persistent State**: All memory persists across sessions with atomic file operations
6. **Token Approximation**: Uses character counting for real-time context management