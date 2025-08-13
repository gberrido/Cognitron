#!/bin/bash

echo "🚀 Setting up Minimalist MemGPT..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Check for API keys
echo "🔑 Checking API keys..."
if [ -z "$GROQ_API_KEY" ] && [ -z "$TOGETHER_API_KEY" ]; then
    echo "⚠️  No API keys found. Please set one of:"
    echo "export GROQ_API_KEY=\"your_groq_key_here\""
    echo "export TOGETHER_API_KEY=\"your_together_key_here\""
    echo ""
    echo "You can get API keys from:"
    echo "- Groq: https://console.groq.com/"
    echo "- Together AI: https://api.together.ai/"
    echo ""
    echo "Add the export command to your ~/.bashrc or ~/.zshrc for persistence."
else
    echo "✅ API keys found"
fi

# Make scripts executable
chmod +x memgpt-minimal.js
chmod +x test-memgpt.js
chmod +x setup-memgpt.sh

# Run tests
echo "🧪 Running tests..."
node test-memgpt.js

if [ $? -eq 0 ]; then
    echo "✅ Setup complete! MemGPT is ready to use."
    echo ""
    echo "Usage:"
    echo "  node memgpt-minimal.js    # Start interactive chat"
    echo "  npm start                 # Same as above"
    echo "  npm test                  # Run tests"
    echo ""
    echo "Available commands in chat:"
    echo "  /help    - Show help"
    echo "  /stats   - Memory statistics" 
    echo "  /search  - Search conversation history"
    echo "  /memory  - Show working context"
    echo "  /exit    - Exit program"
else
    echo "❌ Tests failed. Please check the error messages above."
    exit 1
fi