# Minimalist MemGPT Implementation

A fully-functional, self-contained implementation of MemGPT with hierarchical memory management in a single JavaScript file.

## 🌟 Features

### Core MemGPT Capabilities
- **Hierarchical Memory**: Main context (working memory) + external storage (recall + archival)
- **Automatic Memory Management**: Context overflow handling with queue eviction
- **Persistent Memory**: Conversations and documents persist across sessions  
- **Self-Directed Functions**: Agent autonomously manages its own memory
- **Multi-Step Reasoning**: Function chaining with heartbeat requests

### Memory System
- **Working Context**: Agent persona and user information (editable)
- **Message Queue**: Recent conversation with automatic summarization
- **Recall Storage**: Full conversation history with keyword search
- **Archival Storage**: Document storage with semantic search
- **Zero Dependencies**: File-based storage (JSONL + JSON)

### LLM Provider Support
- **Groq**: GPT-OSS-120B with streaming support
- **Together AI**: GPT-OSS-120B with standard completions
- **Function Calling**: Simulated via JSON parsing for providers without native support

## 🚀 Quick Start

### 1. Setup
```bash
# Make setup script executable and run it
chmod +x setup-memgpt.sh
./setup-memgpt.sh
```

### 2. Set API Keys
```bash
# For Groq (recommended)
export GROQ_API_KEY="your_groq_key_here"

# OR for Together AI  
export TOGETHER_API_KEY="your_together_key_here"
```

### 3. Run MemGPT
```bash
# Start interactive conversation
node memgpt-minimal.js

# Or using npm
npm start
```

## 💬 Usage

### Interactive Chat
```
You: Hello! I'm John and I love hiking.
MemGPT: Nice to meet you, John! I'll remember that you love hiking...

🔧 Function calls executed:
   working_context_append({"new_content": "User John loves hiking"}) -> {"success": true, ...}

You: What do you remember about me?
MemGPT: I remember that your name is John and you love hiking...
```

### Commands
- `/help` - Show available commands
- `/stats` - Memory usage statistics  
- `/search <query>` - Search conversation history
- `/memory` - Show current working context
- `/save` - Save agent state
- `/flush` - Move message queue to recall storage
- `/exit` - Exit and save

### Memory Pressure Example
```
You: [Long conversation continues...]

System Alert: Memory Pressure - Context window approaching capacity. Consider moving important information to working context or searching recall storage.

MemGPT: I see we're running low on context space. Let me save some important details...

🔧 Function calls executed:
   working_context_append({"new_content": "User prefers technical discussions"}) -> {"success": true}
   
🗑️ Memory flushed - older messages moved to recall storage
```

## 🗂️ File Structure

```
memory/
├── conversations/
│   ├── 2024-01-15.jsonl         # Daily conversation logs
│   └── search-index.json        # Keyword search index
├── archival/
│   ├── documents/
│   │   ├── doc1.txt            # Stored documents
│   │   └── doc2.txt
│   └── metadata.json           # Document metadata
└── agents/
    └── default-agent.json      # Agent working context
```

## 🔧 Configuration

### Model Configuration
```javascript
const CONFIG = {
  model: 'openai/gpt-oss-120b',
  provider: 'groq',              // 'groq' or 'together'
  temperature: 0.7,
  maxTokens: 4096,
  memoryDir: './memory',
  agentId: 'default-agent'
};
```

### Memory Limits
```javascript
const MODEL_LIMITS = {
  'openai/gpt-oss-120b': { 
    total: 32000, 
    warning: 22400,    // 70% threshold
    flush: 32000       // 100% threshold
  }
};
```

## 🧪 Testing

```bash
# Run comprehensive tests
npm test

# Or directly
node test-memgpt.js
```

Tests cover:
- Memory manager functionality
- Working context operations  
- Function execution
- Search capabilities
- Document storage

## 📋 Available Functions

The agent can autonomously call these functions:

### Memory Functions
- `working_context_replace(old_content, new_content)` - Update working context
- `working_context_append(new_content)` - Add to working context
- `recall_storage_search(query, page=1)` - Search conversation history
- `archival_storage_search(query, page=1)` - Search documents
- `archival_storage_insert(content)` - Add document

### Function Chaining
Set `"request_heartbeat": true` in function args for multi-step operations:

```json
{"function": "recall_storage_search", "args": {"query": "pizza preferences", "request_heartbeat": true}}
```

## 🏗️ Architecture

### Core Components

1. **MemGPT Class**: Main agent with conversation management
2. **MemoryManager Class**: Handles all storage operations  
3. **Function Executor**: Processes LLM function calls
4. **CLI Interface**: Interactive terminal interface

### Memory Hierarchy

```
┌─────────────────────┐
│   LLM Context       │
│ ┌─────────────────┐ │
│ │ System Prompt   │ │ <- Read-only instructions
│ ├─────────────────┤ │
│ │ Working Context │ │ <- Editable persona + user info  
│ ├─────────────────┤ │
│ │ Message Queue   │ │ <- Recent conversation (FIFO)
│ └─────────────────┘ │
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│  External Storage   │
│ ┌─────────────────┐ │
│ │ Recall Storage  │ │ <- Full conversation history
│ ├─────────────────┤ │  
│ │ Archival Storage│ │ <- Documents + knowledge
│ └─────────────────┘ │
└─────────────────────┘
```

## 🔬 Implementation Details

### Memory Management
- **Automatic**: Context overflow triggers queue eviction
- **Recursive Summarization**: Maintains summary of evicted messages
- **Search Indexing**: Real-time keyword indexing for fast retrieval
- **Pagination**: Prevents search results from overflowing context

### Function Calling
- **JSON Parsing**: Extracts function calls from LLM responses
- **Error Handling**: Returns runtime errors to LLM for self-correction
- **Heartbeat System**: Enables multi-step reasoning chains

### Storage Format
- **JSONL**: Human-readable conversation logs
- **JSON**: Structured metadata and indices
- **Plain Text**: Document storage for maximum compatibility

## 🚨 Troubleshooting

### Common Issues

**"No API keys found"**
```bash
export GROQ_API_KEY="your_key_here"
# Add to ~/.bashrc for persistence
```

**"Module not found"**
```bash
npm install
```

**Memory pressure warnings**
- Normal behavior when context fills up
- Agent automatically manages memory
- Use `/flush` to manually trigger cleanup

**Search returns no results**
- Check query spelling
- Try broader keywords  
- Use `/stats` to verify message count

## 🎯 Example Use Cases

### Learning Assistant
```
You: I'm studying machine learning. Can you help me understand neural networks?
MemGPT: I'd be happy to help! Let me remember you're studying ML...

[Function call to save user interest]

Neural networks are computational models inspired by biological brains...
```

### Personal Assistant  
```
You: Remember I have a meeting with Sarah on Friday at 3pm
MemGPT: I'll remember that for you.

[Function call to save meeting info]

You: What meetings do I have this week?
MemGPT: Let me search my memory...

[Function call to search for meetings]

I found that you have a meeting with Sarah on Friday at 3pm.
```

### Research Helper
```
You: Here's a research paper about quantum computing...
MemGPT: I'll store this document for future reference.

[Function call to save document]

You: What did that quantum paper say about entanglement?
MemGPT: Let me search the document...

[Function call to search archival storage]

According to the paper you shared, quantum entanglement...
```

## 🔗 API Keys

Get your free API keys:
- **Groq**: https://console.groq.com/ (Recommended - fast inference)
- **Together AI**: https://api.together.ai/ (Good alternative)

## 📄 License

MIT License - Feel free to modify and extend!

## 🤝 Contributing

This is a minimalist implementation focused on core MemGPT concepts. For production use, consider:

- Vector databases for semantic search
- More sophisticated function calling
- Web interface  
- Multi-agent support
- Custom embedding models

---

**Built with ❤️ based on the MemGPT research paper: "MemGPT: Towards LLMs as Operating Systems"**