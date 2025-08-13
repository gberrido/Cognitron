# Cognitron06 Quick Start Guide

## Prerequisites

- **Python 3.11+** for the server
- **Node.js 18+** for the CLI client
- **Docker & Docker Compose** (optional, recommended)
- **Groq API Key** (required)

## 🚀 Quick Start (Docker - Recommended)

### 1. Clone and Setup
```bash
cd cognitron06
cp .env.example .env
```

### 2. Configure Environment
Edit `.env` file:
```bash
# REQUIRED: Get your API key from console.groq.com
GROQ_API_KEY=your_groq_api_key_here

# RECOMMENDED: Generate a secure secret
COGNITRON_SECRET_KEY=your-jwt-secret-key-here
```

### 3. Start Server
```bash
docker-compose up -d
```

Rebuild with no cache after making server code changes:

```bash
docker compose down && \
docker compose build --no-cache cognitron06-server && \
docker compose up -d --force-recreate cognitron06-server
```

### 4. Install CLI Client
```bash
cd client
npm install
```

### 5. Start Chatting
```bash
npm start
# or
node src/cli.js chat
```

**Default login**: `demo` / `demo123`

## 🛠️ Manual Setup (Development)

### Server Setup
```bash
cd server
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate    # Windows

pip install -r requirements.txt

# Set environment variables
export GROQ_API_KEY="your_api_key"
export COGNITRON_SECRET_KEY="your_secret_key"

# Start server
python -m uvicorn src.main:app --reload
```

### Client Setup
```bash
cd client
npm install

# Start CLI
npm start
```

## 🔧 Configuration

### Server Configuration (.env)
```bash
GROQ_API_KEY=your_key                 # Required
COGNITRON_SECRET_KEY=your_secret      # Required
COGNITRON_HOST=0.0.0.0               # Default: 0.0.0.0
COGNITRON_PORT=8000                  # Default: 8000
COGNITRON_DEBUG=false                # Default: false
COGNITRON_CORS_ORIGINS=http://localhost:3000  # Comma-separated origins for production
```

### CLI Configuration
The CLI client stores configuration in `~/.cognitron06/config.json`:
```bash
# Set server URL
node src/cli.js config --server http://localhost:8000
```

## 🎯 First Steps

1. **Start a conversation**: Just type a message
2. **Check memory**: `/memory` command
3. **Search history**: `/search <query>`
4. **View status**: `/status` command
5. **Get help**: `/help` command

## 🔗 API Documentation

Once the server is running:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## 🐛 Troubleshooting

### Server won't start
- Check Groq API key is valid
- Ensure port 8000 is available
- Check logs: `docker-compose logs`

### CLI can't connect
- Verify server is running: `curl http://localhost:8000/api/v1/health`
- Check server URL in CLI config
- Try: `node src/cli.js config --server http://localhost:8000`

### Authentication fails
- Default credentials: `demo` / `demo123`
- Clear saved session: `rm -rf ~/.cognitron06`

### Memory issues
- Check data directory permissions
- View memory status: `/memory` command
- Reset if needed: `/clear` command

## 🎉 You're Ready!

Cognitron06 now has persistent memory that resumes conversations exactly where you left off. The AI can remember facts about you, search past conversations, and manage its own memory intelligently.

Try asking: "Remember that my name is [Your Name] and I'm interested in [Your Interest]"

Then restart and watch it remember you! 🧠✨
