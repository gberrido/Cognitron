# Cognitron SDK

A powerful, modular Node.js SDK for building AI applications with the Cognitron AI Assistant. Features persistent memory, model switching, streaming responses, and a professional CLI interface.

## ✨ Features

- 🧠 **MemGPT-Inspired Memory System** - Persistent conversations with working context and archival storage
- 🤖 **Multiple AI Models** - Dynamic switching between different AI models with capabilities info
- 🔄 **Streaming Support** - Real-time streaming responses via WebSocket or Server-Sent Events
- 🔐 **Authentication** - Secure JWT-based authentication with token management
- 📦 **Modular Architecture** - Use individual modules or the complete SDK
- 🖥️ **Professional CLI** - Feature-rich command-line interface with history navigation
- 🎯 **Event-Driven** - Comprehensive event system for monitoring and debugging
- 🔧 **Configuration Management** - Encrypted local configuration with secure storage

## 🚀 Quick Start

### Installation

```bash
npm install cognitron-sdk
```

### Basic Usage

```javascript
import { CognitronSDK } from 'cognitron-sdk';

// Initialize the SDK
const sdk = new CognitronSDK({
  serverUrl: 'http://localhost:8000',
  credentials: {
    username: 'demo',
    password: 'demo123'
  }
});

// Initialize and authenticate
await sdk.initialize();
await sdk.authenticate();

// Send a message
const response = await sdk.sendMessage('Hello! How can you help me?');
console.log(response.content);

// Search memory
const results = await sdk.searchMemory('previous conversations', { maxResults: 5 });
console.log(`Found ${results.total_count} results`);

// Switch models
await sdk.switchModel('gpt-oss-120b');

// Cleanup
await sdk.close();
```

### CLI Usage

```bash
# Interactive chat
npx cognitron-sdk chat

# Ask a single question
npx cognitron-sdk ask "What is artificial intelligence?"

# Show system status
npx cognitron-sdk status

# Show available models
npx cognitron-sdk models

# Search memory
npx cognitron-sdk memory --search "previous conversations"
```

## 📚 API Documentation

### Core SDK Class

#### `CognitronSDK`

The main SDK class that provides a unified interface to all Cognitron capabilities.

```javascript
import { CognitronSDK } from 'cognitron-sdk';

const sdk = new CognitronSDK({
  serverUrl: 'http://localhost:8000',
  timeout: 30000,
  enableStreaming: true,
  autoLogin: true,
  credentials: { username: 'demo', password: 'demo123' },
  debug: false
});
```

**Configuration Options:**
- `serverUrl` - Cognitron server URL (default: 'http://localhost:8000')
- `timeout` - Request timeout in milliseconds (default: 30000)
- `enableStreaming` - Enable streaming responses (default: true)
- `autoLogin` - Automatically login on authentication (default: true)
- `credentials` - Login credentials object
- `debug` - Enable debug logging (default: false)

**Methods:**

```javascript
// Initialization
await sdk.initialize()
await sdk.authenticate(credentials?, force?)

// Chat
await sdk.sendMessage(message, options?)
await sdk.streamChat(message, callbacks?)

// Memory
await sdk.getMemoryStatus()
await sdk.searchMemory(query, options?)

// Models
await sdk.getAvailableModels()
await sdk.switchModel(modelName)
await sdk.getCurrentModel()

// System
await sdk.getSystemStatus()
await sdk.logout()
await sdk.close()
```

### Individual Modules

#### `AuthModule`

Handles authentication and user management.

```javascript
import { AuthModule } from 'cognitron-sdk/auth';

const auth = new AuthModule({ serverUrl: 'http://localhost:8000' });
await auth.initialize();
await auth.login('username', 'password');
```

#### `ChatModule`

Manages chat conversations and streaming.

```javascript
import { ChatModule } from 'cognitron-sdk/chat';

const chat = new ChatModule({ serverUrl: 'http://localhost:8000' });
await chat.initialize();
chat.setToken(authToken);

// Regular message
const response = await chat.sendMessage('Hello');

// Streaming
await chat.streamChat('Tell me a story', {
  onChunk: (chunk) => process.stdout.write(chunk),
  onComplete: (response) => console.log('\nDone!')
});
```

#### `MemoryModule`

Handles memory operations and search.

```javascript
import { MemoryModule } from 'cognitron-sdk/memory';

const memory = new MemoryModule({ serverUrl: 'http://localhost:8000' });
await memory.initialize();
memory.setToken(authToken);

// Memory operations
const status = await memory.getStatus();
const results = await memory.searchMemory('query');
const context = await memory.getWorkingContext();

// Working context
await memory.updateWorkingContext('user_name', 'Alice');
await memory.deleteWorkingContext('old_key');

// Archival storage
await memory.insertArchival('key', 'data', metadata);
const archival = await memory.searchArchival('query');
```

#### `ModelsModule`

Manages AI model selection and switching.

```javascript
import { ModelsModule } from 'cognitron-sdk/models';

const models = new ModelsModule({ serverUrl: 'http://localhost:8000' });
await models.initialize();
models.setToken(authToken);

// Model operations
const available = await models.getAvailableModels();
const current = await models.getCurrentModel();
await models.switchModel('gpt-oss-120b');
const info = await models.getModelInfo('model-name');
```

#### `ConfigModule`

Handles configuration and secure storage.

```javascript
import { ConfigModule } from 'cognitron-sdk/config';

const config = new ConfigModule();
await config.load();

// Configuration
config.set('serverUrl', 'http://localhost:8000');
const serverUrl = config.get('serverUrl');

// Secure storage
await config.setSecure('token', 'secret-value');
const token = await config.getSecure('token');
```

### CLI Interface

#### `CognitronCLI`

Professional command-line interface built on the SDK.

```javascript
import { CognitronCLI } from 'cognitron-sdk/cli';

const cli = new CognitronCLI({
  serverUrl: 'http://localhost:8000',
  debug: false
});

await cli.initialize();
await cli.authenticate();
await cli.startInteractiveChat();
```

## 🎮 Examples

The `examples/` directory contains comprehensive examples:

- [`basic-usage.js`](examples/basic-usage.js) - Basic SDK usage patterns
- [`streaming-chat.js`](examples/streaming-chat.js) - Streaming responses and real-time chat
- [`memory-management.js`](examples/memory-management.js) - Advanced memory operations
- [`model-switching.js`](examples/model-switching.js) - Model management and comparison

Run examples:

```bash
node examples/basic-usage.js
node examples/streaming-chat.js
node examples/memory-management.js
node examples/model-switching.js
```

## 🔧 Configuration

### SDK Configuration

```javascript
const sdk = new CognitronSDK({
  // Server settings
  serverUrl: 'http://localhost:8000',
  timeout: 30000,
  
  // Authentication
  autoLogin: true,
  credentials: {
    username: 'your-username',
    password: 'your-password'
  },
  
  // Streaming preferences
  enableStreaming: true,
  preferWebSocket: false,
  preferSSE: false,
  
  // Debug settings
  debug: false
});
```

### Environment Variables

```bash
export COGNITRON_SERVER_URL=http://localhost:8000
export COGNITRON_USERNAME=demo
export COGNITRON_PASSWORD=demo123
export COGNITRON_DEBUG=true
```

### Local Configuration

The SDK automatically creates configuration files in `~/.cognitron06/`:

- `config.json` - General configuration
- `secure.json` - Encrypted tokens and sensitive data (AES-256-CBC)

## 📡 Events

The SDK modules emit events for monitoring and debugging:

```javascript
// Authentication events
sdk.auth.on('auth_error', (error) => console.log('Auth error:', error));

// Chat events
sdk.chat.on('message_sent', ({ message }) => console.log('Sent:', message));
sdk.chat.on('response_received', (response) => console.log('Received response'));
sdk.chat.on('stream_start', ({ message }) => console.log('Stream started'));
sdk.chat.on('stream_chunk', (chunk) => process.stdout.write(chunk));
sdk.chat.on('stream_complete', (response) => console.log('\nStream complete'));

// Memory events
sdk.memory.on('search_completed', ({ query, results }) => {
  console.log(`Search "${query}" found ${results.total_count} results`);
});

// Model events
sdk.models.on('model_switched', ({ new_model }) => {
  console.log(`Switched to model: ${new_model}`);
});
```

## 🛠️ Development

### Project Structure

```
src/
├── core/                    # Core SDK modules
│   ├── CognitronSDK.js     # Main SDK class
│   ├── auth/               # Authentication module
│   ├── chat/               # Chat functionality
│   ├── memory/             # Memory management
│   ├── models/             # Model management
│   └── config/             # Configuration module
├── cli/                    # CLI implementation
│   ├── CognitronCLI.js     # CLI wrapper class
│   └── ui/                 # UI components
└── index.js                # Main exports

examples/                   # Usage examples
├── basic-usage.js
├── streaming-chat.js
├── memory-management.js
└── model-switching.js

# Legacy CLI implementations (for compatibility)
cognitron-readline.js       # Readline-based CLI
cognitron.js               # Commander.js CLI
simple-cli.js              # Simple raw CLI
```

### Building and Testing

```bash
# Install dependencies
npm install

# Run the new SDK CLI
npm start

# Run legacy CLIs
npm run legacy:start
npm run legacy:dev

# Run tests
npm test

# Linting
npm run lint
```

### Migration from Legacy CLI

The legacy CLI files are preserved for compatibility:

- `cognitron-readline.js` - Previous readline-based implementation
- `cognitron.js` - Previous Commander.js implementation
- `simple-cli.js` - Simple compatibility CLI

To migrate to the SDK:

```javascript
// Old way
import { ChatClient } from './src/chat.js';
const client = new ChatClient();

// New way
import { CognitronSDK } from 'cognitron-sdk';
const sdk = new CognitronSDK();
```

## 📦 Package Exports

The package provides multiple entry points:

```javascript
// Main SDK
import { CognitronSDK } from 'cognitron-sdk';

// Individual modules
import { AuthModule } from 'cognitron-sdk/auth';
import { ChatModule } from 'cognitron-sdk/chat';
import { MemoryModule } from 'cognitron-sdk/memory';
import { ModelsModule } from 'cognitron-sdk/models';
import { ConfigModule } from 'cognitron-sdk/config';

// CLI components
import { CognitronCLI } from 'cognitron-sdk/cli';
import { UIRenderer } from 'cognitron-sdk/ui';
```

## 🔒 Security

- JWT-based authentication with automatic token refresh
- AES-256-CBC encryption for local token storage
- Machine-specific key derivation for secure storage
- Proper error handling without exposing sensitive information

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests and examples
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

- GitHub Issues: [Report bugs and feature requests](https://github.com/your-org/cognitron-sdk/issues)
- Documentation: [Full API documentation](https://docs.cognitron.ai/sdk)
- Examples: See the `examples/` directory for usage patterns

## 🎯 Roadmap

- [ ] React components library
- [ ] Browser SDK variant
- [ ] WebSocket reconnection handling
- [ ] Offline mode support
- [ ] Plugin system
- [ ] TypeScript definitions
- [ ] Performance monitoring
- [ ] Batch operations support