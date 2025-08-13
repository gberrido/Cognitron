# 🧠 Cognitron Enhanced CLI Guide

## Overview

The enhanced Cognitron CLI is a professional, feature-rich command-line interface built with Commander.js that provides multiple ways to interact with your AI assistant.

## Installation & Setup

```bash
cd /Users/saladin/Projects/Cognitron/cognitron06/client
chmod +x cognitron.js
```

## Usage Examples

### 1. Interactive Chat (Default)
Start a continuous conversation with the AI:

```bash
./cognitron.js
# or explicitly:
./cognitron.js chat
```

### 2. Single Questions
Ask a question and get an immediate answer:

```bash
./cognitron.js ask "What is the capital of France?"
./cognitron.js ask "Explain quantum computing" --show-usage
./cognitron.js ask "Write a Python function to reverse a string" --quiet
```

### 3. System Information
Check system status and available models:

```bash
./cognitron.js status
./cognitron.js models
```

## Command Reference

### Global Options
- `-V, --version` - Show version number
- `-s, --server <url>` - Server URL (default: http://localhost:8000)  
- `-m, --model <name>` - AI model to use
- `-v, --verbose` - Show tool calls and detailed output
- `-u, --show-usage` - Display token usage statistics
- `--force-login` - Force new login session
- `--quiet` - Suppress non-essential output
- `-h, --help` - Display help

### Commands

#### `chat` (default)
Start interactive chat session with continuous conversation.

**Features:**
- Persistent memory across the conversation
- Slash commands for system control
- Real-time AI responses with memory integration
- Professional terminal interface

**Interactive Commands:**
- `/help` - Show available commands
- `/memory` - Display memory system status
- `/status` - Show system and server status  
- `/models` - List available AI models
- `/model [name]` - Show current model or switch to another
- `/clear` - Clear the screen
- `/exit` or `/quit` - Exit chat

#### `ask <question>`
Ask a single question and exit.

**Examples:**
```bash
./cognitron.js ask "What is 2+2?"
./cognitron.js ask "Explain machine learning" --verbose
./cognitron.js ask "Help me debug this code" --show-usage
```

#### `status`
Display comprehensive system status including:
- Server connectivity
- Authentication status
- Session information
- System health

#### `models`  
List all available AI models with descriptions and capabilities.

## Advanced Usage

### Using Different Models
```bash
# Chat with a specific model
./cognitron.js chat --model llama3-8b-8192

# Ask a question with a specific model
./cognitron.js ask "Explain AI" --model mixtral-8x7b-32768
```

### Verbose Mode
```bash
# See tool calls and detailed processing
./cognitron.js chat --verbose --show-usage
```

### Server Configuration
```bash
# Connect to different server
./cognitron.js chat --server http://my-server:8000
```

## Interactive Chat Features

### Memory System
- **Working Context**: Active conversation context
- **Conversation Queue**: Recent message history  
- **Archival Storage**: Long-term memory storage
- **Intelligent Context Management**: Automatic context optimization

### Continuous Conversation
- **No Exit After Messages**: Unlike basic CLIs, continues indefinitely
- **Context Preservation**: Maintains conversation context
- **Error Recovery**: Graceful handling of temporary issues
- **Memory Integration**: AI remembers previous interactions

### Professional Interface
- **Colored Output**: Easy-to-read responses with syntax highlighting
- **Status Indicators**: Clear processing and system status
- **Help System**: Comprehensive built-in help
- **Error Messages**: Helpful error reporting with suggestions

## Authentication

The CLI automatically handles authentication:

1. **Auto-Login**: Attempts to log in with saved credentials
2. **Demo Account**: Uses demo/demo123 for quick start
3. **Session Management**: Maintains persistent sessions
4. **Token Refresh**: Automatic token validation and refresh

## Memory System

### Storage Layers
- **Working Context**: Immediate conversation context
- **FIFO Queue**: Recent conversation history  
- **Recall Storage**: Medium-term memory
- **Archival Storage**: Long-term information storage

### Commands
```bash
/memory          # Show memory status
/status          # Full system status including memory
```

## Examples

### Basic Usage
```bash
# Start chatting
./cognitron.js

> Hello! How are you today?
🤖 Processing...
Hi there! I'm doing great, thanks for asking! How can I help you today?

> What's the weather like?
🤖 Processing...
I don't have access to real-time weather data, but I can help you find weather information or discuss weather-related topics. What would you like to know?

> /memory
🧠 Memory System Status:
────────────────────────────
Working Context: 2 entries
Conversation Queue: 4 messages
Total Messages: 4
Archival Storage: 0 entries
Memory Usage: 2%

> /exit
👋 Thanks for using Cognitron! Goodbye!
```

### Single Question Mode
```bash
./cognitron.js ask "What is the difference between Python and JavaScript?"

✅ Welcome back, demo!
🤖 Processing...

Python and JavaScript are both popular programming languages, but they serve different primary purposes:

**Python:**
- General-purpose programming language
- Great for data science, AI/ML, backend development, automation
- Simple, readable syntax
- Interpreted language
- Strong in scientific computing and data analysis

**JavaScript:**
- Originally created for web browsers
- Now used for frontend, backend (Node.js), and mobile development
- Dynamic, prototype-based language
- Event-driven and asynchronous
- Essential for modern web development

Both are versatile languages with active communities and extensive libraries!
```

### System Status
```bash
./cognitron.js status

✅ Welcome back, demo!

🌐 System Status:
────────────────────
Server URL: http://localhost:8000
✅ Server: Cognitron06 Server v1.0.0
Status: running
✅ Authentication: Logged in as demo
Session: 33cfdb36-5640-4751-8dfb-be18a9b1da7f
```

## Troubleshooting

### Common Issues

1. **Connection Error**
   ```bash
   ./cognitron.js status  # Check server connectivity
   ```

2. **Authentication Failed**
   ```bash
   ./cognitron.js chat --force-login  # Force new login
   ```

3. **Memory Issues**
   ```bash
   ./cognitron.js chat
   > /memory  # Check memory status
   ```

### Debug Mode
```bash
./cognitron.js chat --verbose  # See detailed processing
```

## Integration

### Package.json Scripts
The CLI can be integrated into your workflow:

```json
{
  "scripts": {
    "chat": "node cognitron.js chat",
    "ask": "node cognitron.js ask",
    "status": "node cognitron.js status"
  }
}
```

### Shell Aliases
Add to your `.bashrc` or `.zshrc`:

```bash
alias cog="node /path/to/cognitron.js"
alias cogask="node /path/to/cognitron.js ask"
```

## Features Summary

✅ **Professional CLI Interface** - Built with Commander.js  
✅ **Multiple Interaction Modes** - Chat, ask, status, models  
✅ **Continuous Conversation** - No single-message limitations  
✅ **Persistent Memory** - Context preserved across sessions  
✅ **Model Management** - Switch between AI models  
✅ **Comprehensive Help** - Built-in help and documentation  
✅ **Error Recovery** - Graceful error handling  
✅ **Token Usage Tracking** - Monitor API usage  
✅ **Server Management** - Status monitoring and connectivity  
✅ **Authentication Handling** - Automatic login and session management  

The enhanced Cognitron CLI provides a professional, feature-rich experience for interacting with your AI assistant! 🚀