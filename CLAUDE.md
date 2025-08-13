# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cognitron07 is a MemGPT-style AI assistant with persistent memory capabilities. It uses an SDK-based architecture and supports multiple LLM providers (Groq, Together AI, Mock). The system implements sophisticated memory management with recall, archival storage, and context window budgeting.

## Development Commands

### Running the CLI
```bash
# Interactive mode with default provider (Groq)
node cli/index.js

# With specific provider
node cli/index.js --provider groq
node cli/index.js --provider together
node cli/index.js --provider mock

# With custom settings
node cli/index.js --temperature 0.8 --max-tokens 4000 --persona persona.txt

# Run offline tests
node cli/index.js --test
```

### Testing
```bash
# Run all tests
node tests/run-tests.mjs

# Run specific test files
node tests/test_mock_basic.mjs
node tests/test_cli_mock.mjs
node tests/test_recall_archival.mjs
```

## Architecture Overview

### Core Components

**SDK Layer (`/sdk/`)**:
- `agent.js` - Main MemGPTAgent class with memory management and tool execution
- `providerManager.js` - LLM provider abstraction layer
- `tools.js` - MemGPT tool registry (core_memory_append, conversation_search, etc.)

**Memory System (`/sdk/memory/`)**:
- `recall.js` - RecallStore for conversation history with TF-IDF search
- `archival.js` - ArchivalStore for long-term document storage  
- `session.js` - SessionStore for core memory and session state persistence

**Providers (`/sdk/providers/`)**:
- `groq.js` - Groq API integration with streaming support
- `together.js` - Together AI API integration
- `mock.js` - Mock provider for testing

**CLI (`/cli/`)**:
- `index.js` - Command-line interface with interactive mode

### Memory Architecture

The system uses a three-tier memory architecture:

1. **Core Memory** - Key facts stored as key-value pairs (persistent across sessions)
2. **Recall Memory** - Searchable conversation history with TF-IDF indexing
3. **Archival Memory** - Long-term document storage with full-text search

Data is stored in `cognitron-memgpt-data/`:
```
cognitron-memgpt-data/
├── recall-storage.jsonl     # Conversation history
├── recall-index.json        # TF-IDF search index
├── working-context.json     # Core memory state
├── session-state.json       # Session metadata
└── archival/
    ├── documents/           # Stored documents
    ├── embeddings.json      # Document embeddings
    └── metadata.json        # Document metadata
```

### Tool System

The system implements MemGPT-style tools via OpenAI function calling:

- `core_memory_append` - Store key facts about user
- `core_memory_replace` - Update existing core memory
- `conversation_search` - Search past conversation history
- `archival_memory_insert` - Store documents long-term
- `archival_memory_search` - Retrieve stored documents
- `get_memory_status` - Check memory usage and statistics
- `pause_heartbeats` - Signal ready for user response (required)

### Context Window Management

Token budgets are enforced with automatic summarization:
- System messages: ~20% of context
- Summary: ~10% of context  
- Messages: Remaining context
- Automatic eviction and summarization when budgets exceeded

## Interactive Commands

```bash
/help         # Show all commands
/provider <p> # Switch provider (groq|together|mock)
/memory       # Show memory state
/status       # Show provider status and settings
/recall <q>   # Search conversation history
/arch <q>     # Search archival documents
/compact      # Force memory compaction
/stream       # Toggle streaming responses
/think        # Toggle reasoning visibility
/autosum      # Toggle LLM summarization
/debugtools   # Toggle tool call debugging
/clear        # Clear conversation history
/reset        # Reset all memory
/exit         # Save and exit
```

## Development Guidelines

### Environment Variables
- `GROQ_API_KEY` - Required for Groq provider
- `TOGETHER_API_KEY` - Required for Together AI provider

### Code Patterns

**Provider Integration**: All providers must implement `complete()` and `stream()` methods with standardized message/tool format.

**Memory Operations**: Always use the SDK's memory classes (RecallStore, ArchivalStore, SessionStore) rather than direct file operations.

**Tool Development**: New tools should be added to `getToolRegistry()` in `tools.js` and `getToolDefinitions()` for OpenAI function calling.

**Testing**: Use the mock provider for unit tests. Live tests require API keys and should be optional.

### Error Handling

The system implements graceful degradation:
- Provider failures fall back to text-based tool calling
- Memory corruption is handled with automatic recovery
- Token budget overruns trigger automatic summarization
- Tool call failures return structured error responses

## Key Implementation Details

**Streaming Support**: Both Groq and Together AI providers support streaming responses with reasoning visibility.

**Tool Execution**: Supports both OpenAI function calling (preferred) and text-based tool protocols for compatibility.

**Memory Persistence**: All memory operations are atomic with proper error recovery and state consistency.

**Token Counting**: Uses tiktoken-like tokenizer with character-based fallback for accurate budget management.