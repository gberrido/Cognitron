# Minimalist MemGPT/Letta Implementation Requirements

## Executive Summary

This document outlines the requirements for a minimalist implementation of MemGPT/Letta, based on the original research paper "MemGPT: Towards LLMs as Operating Systems" and the current state of the Letta framework (formerly MemGPT). The goal is to create a simplified but functional system that demonstrates the core concepts of virtual context management and hierarchical memory for LLMs.

## 1. Core Architecture Requirements

### 1.1 Memory Hierarchy
- **Main Context (Physical Memory)**: Fixed-size LLM context window split into:
  - System Instructions (read-only)
  - Working Context (read-write via functions)
  - FIFO Message Queue (managed automatically)
- **External Context (Virtual Memory)**: Out-of-context storage split into:
  - Recall Storage (conversation history)
  - Archival Storage (documents, knowledge base)

### 1.2 Context Window Management
- **Memory Pressure Warnings**: Alert system when context approaches capacity (70% threshold)
- **Queue Eviction**: Automatic removal of older messages when context is full (100% threshold)
- **Recursive Summarization**: Maintain summary of evicted messages at queue head
- **Pagination Support**: Prevent memory retrieval from overflowing context window

## 2. Function Calling System

### 2.1 Core Memory Functions
```
working_context.replace(old_content, new_content)
working_context.append(new_content)
```

### 2.2 External Memory Functions
```
recall_storage.search(query, page=1)
archival_storage.search(query, page=1)
archival_storage.insert(content)
```

### 2.3 Control Flow
- **Function Chaining**: Support `request_heartbeat=true` parameter for multi-step operations
- **Event-Driven Execution**: Process user messages, system alerts, and scheduled events
- **Error Handling**: Return runtime errors to LLM for self-correction

## 3. Memory Storage Requirements

### 3.1 Recall Storage (Conversation Memory)
- **Message Logging**: Store all user/assistant exchanges with metadata
- **Search Capability**: Keyword-based search with relevance scoring
- **Session Management**: Track conversation sessions and message IDs
- **Storage Format**: JSONL files for human readability and zero dependencies

### 3.2 Archival Storage (Knowledge Base)
- **Document Storage**: Support arbitrary length text objects
- **Vector Search**: Semantic search using embeddings (default: OpenAI text-embedding-ada-002)
- **Insertion API**: Allow dynamic addition of documents
- **Flexible Backend**: Support file-based storage or vector databases (Chroma, pgvector)

## 4. Agent Persona System

### 4.1 Working Context Structure
- **Agent Persona**: Editable personality and role definition
- **User Information**: Persistent facts and preferences about the user
- **Dynamic Updates**: Self-directed editing based on conversation context

### 4.2 Consistency Requirements
- **Fact Tracking**: Remember and reference previous statements
- **Preference Learning**: Adapt responses based on user feedback
- **Persona Evolution**: Update agent characteristics over time

## 5. Implementation Specifications

### 5.1 Minimum Viable System
- **Single Agent Support**: One agent instance per conversation
- **File-Based Storage**: No database dependencies
- **OpenAI Integration**: Support GPT-3.5, GPT-4, and GPT-4 Turbo
- **Basic CLI Interface**: Command-line interaction with memory commands

### 5.2 File Structure
```
memory/
├── conversations/
│   ├── YYYY-MM-DD.jsonl     # Daily conversation logs
│   └── search-index.json    # Keyword search index
├── archival/
│   ├── documents/           # Text documents
│   ├── embeddings.json      # Vector embeddings cache
│   └── metadata.json       # Document metadata
└── agents/
    ├── {agent_id}.json      # Agent persona and working context
    └── system-prompt.txt    # MemGPT system instructions
```

### 5.3 Context Window Limits
- **GPT-3.5 Turbo**: 16K tokens (warning at 11.2K, flush at 16K)
- **GPT-4**: 8K tokens (warning at 5.6K, flush at 8K)
- **GPT-4 Turbo**: 128K tokens (warning at 89.6K, flush at 128K)

## 6. System Instructions Template

### 6.1 Core Prompt Structure
```
You are MemGPT, an AI assistant with hierarchical memory management.

MEMORY HIERARCHY:
- Working Context: Your current personality and user information
- Message Queue: Recent conversation history
- Recall Storage: Full conversation history (searchable)
- Archival Storage: Documents and knowledge base (searchable)

MEMORY FUNCTIONS:
[Function schemas and descriptions]

MEMORY MANAGEMENT:
- Monitor memory pressure warnings
- Use functions to move important info from queue to working context
- Search external memory when needed for context
- Request heartbeats for multi-step operations
```

### 6.2 Behavioral Guidelines
- **Autonomous Memory Management**: Self-direct when to save/retrieve information
- **Context Awareness**: Understand memory limitations and work within them
- **User Transparency**: Explain memory operations when relevant
- **Continuous Learning**: Update understanding based on interactions

## 7. Evaluation Criteria

### 7.1 Core Functionality Tests
- **Deep Memory Retrieval**: Answer questions requiring historical context
- **Document Analysis**: Process documents exceeding context window
- **Persona Consistency**: Maintain coherent personality across sessions
- **Context Management**: Handle memory pressure without losing important information

### 7.2 Performance Metrics
- **Memory Efficiency**: Effective use of limited context window
- **Retrieval Accuracy**: Relevant information discovery from external memory
- **Response Quality**: Contextually appropriate and factually consistent outputs
- **System Reliability**: Graceful handling of edge cases and errors

## 8. Technical Dependencies

### 8.1 Required Libraries
- **OpenAI SDK**: LLM API integration
- **JSON**: Configuration and data storage
- **File I/O**: Memory persistence
- **Basic NLP**: Text preprocessing and search

### 8.2 Optional Enhancements
- **Vector Database**: Chroma, pgvector, or similar for semantic search
- **Web Interface**: Simple UI for agent interaction
- **Multi-Agent Support**: Multiple concurrent agent instances
- **Custom Embeddings**: Alternative to OpenAI embeddings

## 9. Success Metrics

A minimalist MemGPT implementation should achieve:

1. **Memory Persistence**: Maintain information across conversation sessions
2. **Context Scalability**: Handle conversations and documents exceeding LLM limits
3. **Autonomous Operation**: Self-manage memory without manual intervention
4. **User Experience**: Natural conversation flow despite memory constraints
5. **Extensibility**: Foundation for adding advanced features

## 10. Development Phases

### Phase 1: Core Memory System
- Basic FIFO queue management
- Working context functions
- File-based recall storage

### Phase 2: External Memory
- Archival storage implementation
- Search functionality
- Document processing

### Phase 3: Agent Intelligence
- Self-directed memory management
- Persona consistency
- Multi-step reasoning

### Phase 4: Polish & Optimization
- Performance improvements
- Error handling
- User experience enhancements

---

## 11. API Configuration & GPT-OSS-120B Integration

### 11.1 Environment Variables
```bash
export TOGETHER_API_KEY="YOUR_TOGETHER_API_KEY_HERE"
export GROQ_API_KEY="YOUR_GROQ_API_KEY_HERE"
```

### 11.2 Together AI Integration
```javascript
import Together from "together-ai";

const together = new Together();

const response = await together.chat.completions.create({
  messages: [
    {
      role: "user",
      content: "What are some fun things to do in New York?"
    }
  ],
  model: "openai/gpt-oss-120b"
});

console.log(response.choices[0].message.content);
```

### 11.3 Groq Integration
```javascript
import { Groq } from 'groq-sdk';

const groq = new Groq();

const chatCompletion = await groq.chat.completions.create({
  "messages": [
    {
      "role": "user",
      "content": ""
    }
  ],
  "model": "openai/gpt-oss-120b",
  "temperature": 1,
  "max_completion_tokens": 8192,
  "top_p": 1,
  "stream": true,
  "reasoning_effort": "medium",
  "stop": null
});

for await (const chunk of chatCompletion) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

### 11.4 Model Provider Support
The minimalist MemGPT implementation should support multiple LLM providers:
- **OpenAI**: GPT-3.5, GPT-4, GPT-4 Turbo (primary support)
- **Groq**: GPT-OSS-120B with streaming and reasoning effort controls
- **Together AI**: GPT-OSS-120B with standard completion interface

---

**Note**: This minimalist implementation focuses on the core innovations of MemGPT while maintaining simplicity and zero external dependencies. It serves as a foundation that can be extended with more sophisticated features as needed.