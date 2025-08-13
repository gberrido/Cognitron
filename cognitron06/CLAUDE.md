# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Cognitron06 is a client-server AI assistant with MemGPT-inspired persistent memory. This is a complete architectural refactor from Cognitron05, moving from a monolithic CLI to a scalable client-server design.

## Development Commands

### Server Development
```bash
cd server

# Install dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt

# Set environment variables
export GROQ_API_KEY="your_key"
export COGNITRON_SECRET_KEY="your_secret"

# Run server
python -m uvicorn src.main:app --reload --port 8000

# Run tests
python -m pytest tests/

# Linting
black src/
ruff src/
```

### Client Development
```bash
cd client

# Install dependencies
npm install

# Run CLI
npm start
node src/cli.js chat

# Run tests
npm test

# Linting
npm run lint
```

### Docker Development
```bash
# Development environment
docker-compose up -d

# Production environment
cd deploy
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose logs -f cognitron06-server
```

## Architecture

### Server Architecture (FastAPI + Python)
```
server/
├── src/
│   ├── main.py                    # FastAPI app entry point
│   ├── core/
│   │   ├── config.py             # Configuration management
│   │   ├── memory_system.py      # MemGPT memory system (Python port)
│   │   └── chat_agent.py         # Groq integration with memory tools
│   ├── api/
│   │   ├── auth.py               # JWT authentication endpoints
│   │   ├── chat.py               # Chat endpoints (REST)
│   │   ├── memory.py             # Memory management endpoints
│   │   ├── websocket.py          # WebSocket streaming endpoints
│   │   └── health.py             # Health check endpoints
│   ├── services/
│   │   └── session_manager.py    # User session management
│   └── models/
│       ├── auth_models.py        # Pydantic models for auth
│       ├── chat_models.py        # Pydantic models for chat
│       └── memory_models.py      # Pydantic models for memory
```

### Client Architecture (Node.js CLI)
```
client/
├── src/
│   ├── cli.js                    # Main CLI entry point with Commander.js
│   ├── auth.js                   # Authentication client (axios)
│   ├── chat.js                   # Chat client (axios + WebSocket)
│   ├── memory.js                 # Memory client (axios)
│   ├── config.js                 # Configuration management with keytar
│   └── ui.js                     # UI rendering with chalk + marked
```

### Key Design Patterns

#### Memory System Architecture
The server implements MemGPT-inspired hierarchical memory per user:
- **Working Context**: Core facts (2000 token limit)
- **FIFO Queue**: Recent messages (20 message limit)
- **Recall Storage**: Complete conversation history (JSONL)
- **Archival Storage**: Long-term structured data with search

#### API Design Patterns
- **RESTful endpoints** for standard operations
- **WebSocket streaming** for real-time chat
- **JWT authentication** with refresh tokens
- **Pydantic models** for request/response validation
- **Dependency injection** for service access

#### Client-Server Communication
- **HTTP/REST** for standard requests
- **WebSocket** for streaming chat responses
- **JWT tokens** stored securely with keytar
- **Automatic token refresh** on expiration

## Key Configuration

### Environment Variables (Server)
```python
# Required
GROQ_API_KEY=your_groq_api_key
COGNITRON_SECRET_KEY=your_jwt_secret

# Optional with defaults
COGNITRON_HOST=0.0.0.0
COGNITRON_PORT=8000
COGNITRON_DEBUG=false
COGNITRON_DATA_DIR=./cognitron06-data
```

### Memory System Configuration
Located in `server/src/core/config.py`:
```python
max_working_context_size: 2000    # tokens
max_fifo_queue_size: 20          # messages
memory_pressure_threshold: 0.8   # trigger at 80%
context_window_size: 8192        # Groq model limit
```

### API Endpoints Structure
- `/api/v1/auth/*` - Authentication (login, logout, refresh)
- `/api/v1/chat/*` - Chat operations (message, stream, history)
- `/api/v1/memory/*` - Memory operations (status, search, context)
- `/api/v1/ws/*` - WebSocket endpoints (streaming chat)
- `/api/v1/health` - Health checks

## Development Workflow

### Adding New API Endpoints
1. Define Pydantic models in `models/`
2. Create endpoint functions in `api/`
3. Include router in `main.py`
4. Add client methods in `client/src/`
5. Update CLI commands if needed

### Memory System Extensions
1. Modify core logic in `core/memory_system.py`
2. Add corresponding API endpoints in `api/memory.py`
3. Update client methods in `client/src/memory.js`
4. Add CLI commands for new features

### Authentication Flow
1. Client calls `/auth/login` with credentials
2. Server validates and returns JWT token
3. Client stores token securely with keytar
4. All subsequent requests include `Authorization: Bearer <token>`
5. Server validates token using dependency injection

## Data Persistence

### File-Based Storage (Current)
- **User memory**: `{user_id}_working_context.json`
- **Conversations**: `{user_id}_recall_storage.jsonl`
- **Archival data**: `{user_id}_archival_storage.json`
- **Location**: Configurable data directory

### Database Migration Path (Future)
- PostgreSQL for user data and conversations
- Redis for session storage and caching
- File storage for binary/large data

## Testing Strategy

### Server Tests
```bash
cd server
python -m pytest tests/
# Test categories: unit, integration, memory, api
```

### Client Tests
```bash
cd client
npm test
# Test categories: unit, integration, cli
```

### Docker Testing
```bash
docker-compose -f docker-compose.test.yml up --abort-on-container-exit
```

## Security Considerations

1. **API Keys**: Server-side only, never in client
2. **JWT Secrets**: Cryptographically secure, env-only
3. **CORS**: Configured for development, restrict in production
4. **Rate Limiting**: Implemented in nginx for production
5. **Input Validation**: Pydantic models validate all inputs
6. **Secure Storage**: Client uses keytar for token storage

## Critical Implementation Details

1. **Memory Pressure Management**: Automatic context window management
2. **Session Persistence**: Users resume exactly where they left off
3. **Tool Calling**: AI autonomously manages its own memory
4. **Streaming**: Real-time WebSocket responses with tool calls
5. **Multi-User**: Isolated memory per user with concurrent access
6. **Error Handling**: Comprehensive error recovery and user feedback

## Migration from Cognitron05

The codebase maintains conceptual compatibility with Cognitron05's memory format but implements a completely new architecture. The server port preserves all MemGPT concepts while adding scalability and multi-user support.