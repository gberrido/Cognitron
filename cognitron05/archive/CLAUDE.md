# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Cognitron05** is a true MemGPT-style autonomous CLI chat assistant with persistent memory and tool calling capabilities. The system implements the MemGPT architecture with a heartbeat mechanism that allows the AI to chain multiple function calls before responding to users.

**Current Implementation**: `cognitron05-memgpt.js` - Production-ready MemGPT autonomous agent

## Development Commands

### Core Commands
```bash
# Interactive mode - Start chat session
node cognitron05-memgpt.js

# Single question mode
node cognitron05-memgpt.js ask "your question here"

# Interactive mode with debugging
DEBUG=true node cognitron05-memgpt.js

# Note: npm scripts currently reference non-existent cognitron05.js
```

### Testing Commands

#### Comprehensive Memory Testing
```bash
# Full automated stress test suite
node test-memgpt-stress.js          # Comprehensive memory system testing
                                    # Tests: memory pressure, tool calling, persistence, 
                                    #        search/recall, edge cases, high-volume operations

# Interactive validation with guided scenarios
node test-memgpt-interactive.js     # Real-world scenario testing with user interaction
                                    # Tests: memory storage/recall, pressure handling,
                                    #        session persistence, complex information storage

# Load and performance testing  
node test-memgpt-load.js [ops] [concurrency]  # Load testing with configurable parameters
                                              # Example: node test-memgpt-load.js 100 2
                                              # Tests sustained operations and performance
```

#### Legacy Testing Scripts
```bash
# Basic CLI testing
node quick-test-cli.js              # Quick CLI functionality test
node fixed-cli-test.js              # CLI validation test

# System shell scripts
./test-memory-pressure.sh           # Memory pressure shell script
./test-real-memgpt.sh               # MemGPT validation shell script

# Development utilities
node establish-session.js           # Session establishment testing
node setup-encryption.js            # Encryption setup utility
```

## MemGPT Architecture

### Core Components

**cognitron05-memgpt.js** implements a complete MemGPT system with:
- **Autonomous tool calling** - AI decides when to use memory tools
- **Heartbeat mechanism** - AI can chain multiple LLM calls before responding
- **Persistent memory** - Working context, conversation history, and archival storage
- **Context window management** - Automatic memory pressure handling

### Memory System Design

The system implements four types of memory storage:

1. **Working Context** (`Map`) - Editable core memory for persistent facts about user
2. **Conversation Context** (`Array`) - FIFO queue with automatic eviction
3. **Recursive Summary** (`String`) - Compressed history when memory pressure hits
4. **Archival Storage** (`Map`) - Long-term structured data with search capabilities

### Data Persistence

All data stored in `./cognitron-memgpt-data/`:
- `memory.json` - Working context and core memories  
- `recall-storage.jsonl` - Complete conversation history (append-only)
- `working-context.json` - Persistent facts about user

## MemGPT Tools

The AI has autonomous access to these memory management functions:

### Core Memory Tools
```javascript
core_memory_append(key, value)      // Store key facts about user
core_memory_replace(key, new_value) // Update existing memories
```

### Conversation Tools  
```javascript
conversation_search(query, limit)   // Search past conversations
get_memory_status()                 // Check memory system status
```

### Archival Memory Tools
```javascript
archival_memory_insert(content)     // Store complex data long-term
archival_memory_search(query)       // Retrieve stored data
```

### Control Flow Tool
```javascript
pause_heartbeats(message)           // Signal end of processing, respond to user
```

## MemGPT Control Flow

### Heartbeat Mechanism
The system implements the core MemGPT control pattern:

1. **User Input** → System processes message
2. **Autonomous Phase** → AI can make multiple function calls:
   - Store memories with `core_memory_append` 
   - Search conversations with `conversation_search`
   - Retrieve archival data with `archival_memory_search`
   - Chain as many tool calls as needed
3. **User Response** → AI calls `pause_heartbeats(message)` to end cycle

### Example Flow
```
User: "My name is Alice, I love pizza"
→ AI: core_memory_append(key="user_name", value="Alice")
→ AI: core_memory_append(key="food_preference", value="loves pizza")  
→ AI: pause_heartbeats(message="Nice to meet you Alice! I've noted that you love pizza.")
```

## Configuration

### Environment Variables
```bash
# Required: Groq API key
export GROQ_API_KEY="your-api-key-here"

# Optional: Debug mode for verbose logging
export DEBUG=true
```

### Memory System Configuration
Key constants in `cognitron05-memgpt.js`:
```javascript
maxContextWindow: 8192              // Model's context limit  
memoryPressureThreshold: 0.70       // 70% warning threshold
evictionThreshold: 1.00             // 100% forced eviction
evictionPercentage: 0.50            // Remove 50% on pressure
```

### Model Configuration
```javascript
model: 'openai/gpt-oss-120b'        // Groq model endpoint
temperature: 0.7                    // Response randomness
maxTokens: 2000                     // Max response length
```

## Key Development Patterns

### Memory Pressure Management
The system automatically handles context window pressure:
- **Monitoring**: Tracks token usage against 8192 token limit
- **Warning**: Triggers at 70% usage (memoryPressureThreshold)  
- **Eviction**: Removes 50% of conversation history at 100% usage
- **Summarization**: Creates recursive summaries of evicted messages

### Token Counting
Uses GPT-3 approximation for real-time token management:
```javascript
// 4 characters ≈ 1 token approximation
countTokens(text) {
  return Math.ceil(text.length / 4);
}
```

### Autonomous Tool Usage
The AI autonomously decides when to:
- **Store memories** when learning about user preferences
- **Search conversations** when user references past interactions
- **Use archival storage** for complex data persistence
- **End interactions** with `pause_heartbeats`

## Testing and Validation

### Testing Philosophy
The MemGPT system includes comprehensive testing to ensure memory mechanisms work correctly under various conditions:

### Test Categories

1. **Stress Testing** (`test-memgpt-stress.js`)
   - **Memory Pressure**: Forces eviction and summarization by filling context window
   - **Tool Calling**: Validates all 7 MemGPT tools work correctly
   - **Persistence**: Tests save/load across sessions with data integrity  
   - **Search/Recall**: Tests conversation and archival search functionality
   - **Edge Cases**: Invalid inputs, empty states, malformed data
   - **High Volume**: 100+ rapid operations to test performance limits

2. **Interactive Validation** (`test-memgpt-interactive.js`)
   - **Guided Scenarios**: Step-by-step real-world test cases
   - **Memory Storage**: "Tell AI about yourself" → verify autonomous storage
   - **Memory Pressure**: Long conversations → watch eviction behavior
   - **Session Persistence**: Exit/restart → verify memory restoration
   - **Heartbeat Analysis**: Visual validation of tool call chains

3. **Load Testing** (`test-memgpt-load.js`)
   - **Performance Metrics**: Response time, throughput, error rates
   - **Sustained Operations**: Extended operation periods with realistic patterns
   - **Memory Stress**: Accelerated memory pressure with small context windows
   - **Concurrency**: Configurable parallel operation testing

### Validation Indicators
When testing, watch for these key behaviors:

```
🧠 MemGPT Memory Operations:
   ✅ core_memory_append(key="user_name", value="Alice")
   ✅ core_memory_append(key="interests", value="machine learning")  
   ✅ pause_heartbeats(message="Nice to meet you Alice!")

📊 VALIDATION INDICATORS:
   ✅ Memory operations detected (storing/updating facts)
   ✅ Search operations detected (recalling information)  
   ✅ Proper heartbeat mechanism (ended with pause_heartbeats)
```

### Running Tests
```bash
# Complete validation suite
node test-memgpt-stress.js          # ~2-3 minutes, automated
node test-memgpt-interactive.js     # ~10-15 minutes, guided scenarios  
node test-memgpt-load.js 50 1       # ~3-5 minutes, performance testing

# Quick validation
node cognitron05-memgpt.js
> My name is Alice and I love programming
# Watch for: core_memory_append calls + pause_heartbeats
```

## Critical Implementation Details

1. **Heartbeat Loop**: AI continues processing until `pause_heartbeats` is called
2. **Tool Chaining**: Multiple function calls can be chained in single interaction
3. **Memory Persistence**: All data persists across sessions using file-based storage
4. **Context Window**: Real-time token tracking prevents API context overflow
5. **Error Recovery**: Comprehensive error handling with graceful degradation
6. **Autonomous Decision Making**: AI decides tool usage without user prompting

## Dependencies
```json
{
  "groq-sdk": "^0.7.0",     // Groq LLM API client
  "chalk": "^5.3.0",        // Terminal colors and styling
  "commander": "^12.0.0",   // CLI argument parsing
  "marked": "^16.1.2",      // Markdown rendering for AI responses
  "axios": "^1.11.0",       // HTTP client for API calls
  "readline": "^1.3.0"      // Interactive CLI input handling
}
```

## Quick Start
```bash
# Install dependencies
npm install

# Set up API key
export GROQ_API_KEY="your-groq-api-key"

# Start MemGPT chat session
node cognitron05-memgpt.js

# The AI will autonomously manage its memory and respond to your questions
```

## File Structure (Current Production)
```
cognitron05-memgpt.js           # Main MemGPT implementation
cognitron-memgpt-data/          # Memory persistence directory
├── memory.json                 # Working context storage
├── recall-storage.jsonl        # Conversation history (append-only)
└── working-context.json        # User facts and preferences

package.json                    # Dependencies and scripts
quick-test-cli.js              # CLI testing utility
test-real-memgpt.sh            # MemGPT system validation
```

The system is designed to be a true implementation of the MemGPT architecture, providing autonomous memory management while maintaining persistent user context across sessions.