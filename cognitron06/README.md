# Cognitron06 - Client-Server AI Assistant

**An advanced AI assistant with MemGPT-inspired memory, refactored into a scalable client-server architecture.**

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│             Cognitron Server                 │
│  (FastAPI + MemGPT Memory + Groq AI)       │
├─────────────────────────────────────────────┤
│  REST API + WebSocket                      │
│  Authentication & Session Management        │
│  Centralized Memory System                 │
└─────────────────────────────────────────────┘
                    ↕️ HTTP/WS
┌─────────────────────────────────────────────┐
│              Clients                         │
├─────────────────────────────────────────────┤
│  • CLI Client (Node.js)                     │
│  • Web Dashboard (Future)                   │
│  • API SDKs (Future)                        │
│  • Mobile Apps (Future)                     │
└─────────────────────────────────────────────┘
```

## Project Structure

```
cognitron06/
├── server/                  # FastAPI Server
│   ├── src/
│   │   ├── core/           # Core business logic
│   │   ├── api/            # API endpoints
│   │   ├── services/       # Service layer
│   │   └── models/         # Data models
│   └── tests/
├── client/                 # CLI Client
│   ├── src/               # Client implementation
│   └── tests/
├── shared/                # Shared utilities/types
├── docs/                  # Documentation
└── deploy/                # Deployment configs
```

## Quick Start

### 1. Start the Server
```bash
cd server
pip install -r requirements.txt
export GROQ_API_KEY=your_api_key_here
python -m uvicorn src.main:app --reload
```

### 2. Use the CLI Client
```bash
cd client
npm install
node src/cli.js chat
```

## Key Features

- **Client-Server Architecture**: Scalable design supporting multiple client types
- **MemGPT Memory System**: Persistent, hierarchical memory across sessions
- **WebSocket Streaming**: Real-time response streaming
- **RESTful API**: Complete API for integration
- **Session Management**: User authentication and session persistence
- **Multi-User Support**: Concurrent users with isolated memories
- **Docker Support**: Containerized deployment
- **API Documentation**: Auto-generated OpenAPI docs

## Development

### Server Development
```bash
cd server
pip install -r requirements-dev.txt
python -m pytest tests/
python -m uvicorn src.main:app --reload --port 8000
```

### Security & Configuration
- Set `GROQ_API_KEY` and a strong `COGNITRON_SECRET_KEY` in your environment or `.env` (never commit secrets).
- Configure CORS origins for production via `COGNITRON_CORS_ORIGINS` (comma-separated), otherwise defaults apply.
- In production, set `COGNITRON_DEBUG=false` to avoid returning internal error details.
- The server runs in Docker via `docker-compose.yml`. Rebuild with no cache after code changes: 
  `docker compose down && docker compose build --no-cache cognitron06-server && docker compose up -d --force-recreate cognitron06-server`.

### Client Development
```bash
cd client
npm install
npm test
npm run dev
```

## API Documentation

Once the server is running, visit:
- **OpenAPI Docs**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Deployment

### Docker Compose
```bash
docker-compose up -d
```

### Manual Deployment
See `docs/deployment.md` for detailed instructions.

## Migration from Cognitron05

Cognitron06 is a complete architectural rewrite that maintains compatibility with Cognitron05's memory format. Your existing conversations and memory can be migrated using the provided migration tools.

## License

MIT License - see LICENSE file for details.
