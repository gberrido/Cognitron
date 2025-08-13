# Cognitron06 API Reference

## Base URL
```
http://localhost:8000/api/v1
```

## Authentication

All API endpoints (except health checks) require authentication using JWT Bearer tokens.

### Login
```http
POST /auth/login
Content-Type: application/json

{
  "username": "demo",
  "password": "demo123"
}
```

**Response:**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "token_type": "bearer",
  "expires_in": 1800,
  "session_id": "session-20240101120000-abcd"
}
```

### Use Token
Include in all subsequent requests:
```http
Authorization: Bearer <access_token>
```

## Chat API

### Send Message
```http
POST /chat/message
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Hello, how are you?",
  "temperature": 0.7,
  "max_tokens": 2048
}
```

**Response:**
```json
{
  "content": "Hello! I'm doing well, thank you for asking...",
  "tool_calls": [
    {
      "tool_call_id": "call_123",
      "function_name": "core_memory_append",
      "result": {
        "success": true,
        "message": "Added to core memory: greeting_style = friendly"
      }
    }
  ],
  "session_id": "session-20240101120000-abcd",
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 75,
    "total_tokens": 225
  }
}
```

### Stream Message
```http
POST /chat/stream
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Tell me a story",
  "stream": true
}
```

**Response:** Server-Sent Events stream
```
data: {"content": "Once", "session_id": "session-...", "is_complete": false}
data: {"content": " upon", "session_id": "session-...", "is_complete": false}
data: {"content": " a time...", "session_id": "session-...", "is_complete": false}
data: {"content": "", "session_id": "session-...", "is_complete": true}
```

### WebSocket Chat
```javascript
const ws = new WebSocket('ws://localhost:8000/api/v1/ws/chat?token=<token>');

// Send message
ws.send(JSON.stringify({
  type: 'chat',
  message: 'Hello!',
  stream: true
}));

// Receive responses
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.type, data.content);
};
```

**WebSocket Message Types:**
- `system` - Connection established
- `stream_start` - Streaming began
- `stream_chunk` - Content chunk
- `stream_end` - Streaming complete
- `tool_call` - Memory tool executed
- `error` - Error occurred
- `typing` - Typing indicator

## Memory API

### Get Memory Status
```http
GET /memory/status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "session_id": "session-20240101120000-abcd",
  "user_id": "demo",
  "working_context_size": 3,
  "fifo_queue_length": 15,
  "recall_storage_size": 145,
  "archival_storage_size": 2,
  "context_token_count": 1250,
  "memory_pressure": 0.65,
  "last_save_time": "2024-01-01T12:00:00Z"
}
```

### Get Working Context
```http
GET /memory/working-context
Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "key": "user_name",
    "value": "Alice",
    "last_updated": "2024-01-01T12:00:00Z",
    "update_count": 1
  },
  {
    "key": "favorite_topic",
    "value": "machine learning",
    "last_updated": "2024-01-01T12:05:00Z",
    "update_count": 2
  }
]
```

### Update Working Context
```http
POST /memory/working-context
Authorization: Bearer <token>
Content-Type: application/json

{
  "key": "user_location",
  "value": "San Francisco"
}
```

### Search Memory
```http
POST /memory/search
Authorization: Bearer <token>
Content-Type: application/json

{
  "query": "machine learning",
  "max_results": 10,
  "session_filter": "session-20240101120000-abcd"
}
```

**Response:**
```json
{
  "query": "machine learning",
  "results": [
    {
      "id": "msg-123",
      "timestamp": "2024-01-01T12:00:00Z",
      "session_id": "session-20240101120000-abcd",
      "role": "user",
      "content": "I'm interested in machine learning algorithms",
      "relevance_score": 8.5
    }
  ],
  "total_count": 1
}
```

### Insert Archival Memory
```http
POST /memory/archival
Authorization: Bearer <token>
Content-Type: application/json

{
  "key": "project_requirements",
  "data": "The user needs a chatbot that can remember preferences and context across sessions...",
  "metadata": {
    "category": "project",
    "priority": "high"
  }
}
```

### Search Archival Memory
```http
POST /memory/archival/search
Authorization: Bearer <token>
Content-Type: application/json

{
  "query": "project requirements",
  "max_results": 5
}
```

### List Sessions
```http
GET /memory/sessions
Authorization: Bearer <token>
```

**Response:**
```json
{
  "sessions": [
    {
      "session_id": "session-20240101120000-abcd",
      "start_time": "2024-01-01T12:00:00Z",
      "end_time": "2024-01-01T12:30:00Z",
      "message_count": 25
    }
  ],
  "total_sessions": 1,
  "current_session": "session-20240101120000-abcd"
}
```

## Authentication API

### Get User Info
```http
GET /auth/me
Authorization: Bearer <token>
```

**Response:**
```json
{
  "username": "demo",
  "session_id": "session-20240101120000-abcd",
  "is_active": true,
  "created_at": "2024-01-01T12:00:00Z",
  "last_activity": "2024-01-01T12:15:00Z"
}
```

### Logout
```http
POST /auth/logout
Authorization: Bearer <token>
```

### Refresh Token
```http
POST /auth/refresh
Authorization: Bearer <token>
```

## Health API

### Health Check
```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00Z",
  "service": "cognitron06-server"
}
```

### System Status
```http
GET /status
```

**Response:**
```json
{
  "status": "operational",
  "timestamp": "2024-01-01T12:00:00Z",
  "services": {
    "memory_system": "operational",
    "chat_agent": "operational",
    "session_manager": "operational"
  },
  "statistics": {
    "active_sessions": 3,
    "total_sessions": 15
  },
  "version": "1.0.0"
}
```

## Error Responses

All errors follow this format:
```json
{
  "error": "Authentication failed",
  "detail": "Invalid token or token expired",
  "code": "AUTH_ERROR"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request
- `401` - Unauthorized
- `404` - Not Found
- `422` - Validation Error
- `500` - Internal Server Error

## Rate Limits

- API endpoints: 10 requests/second per IP
- WebSocket connections: 5 connections/second per IP
- Memory operations: 30 requests/minute per user

## SDKs and Examples

See the `client/` directory for a complete Node.js CLI implementation demonstrating all API features.