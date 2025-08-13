# LLM Provider Setup Guide

## Quick Setup

### 1. Install Dependencies
```bash
npm install
# This adds together-ai dependency automatically
```

### 2. Set Up API Keys

#### For Groq (Free Tier Available)
```bash
export GROQ_API_KEY="your-groq-api-key-here"
```

#### For Together AI (Better Pricing)
```bash
export TOGETHER_API_KEY="your-together-api-key-here"
```

#### Both (Auto-fallback)
```bash
export GROQ_API_KEY="your-groq-api-key"
export TOGETHER_API_KEY="your-together-api-key"
```

### 3. Quick Test
```bash
# Test current provider
node llm-provider-manager.js test

# Set provider to Together AI
node llm-provider-manager.js set together

# Test Together AI
node llm-provider-manager.js test together

# Start MemGPT with chosen provider
node cognitron05-memgpt.js
```

## Provider Management Commands

### In MemGPT Chat
```bash
# Show current provider
> /llm

# Switch provider
> /provider together
> /provider groq

# Regular MemGPT usage continues...
> hello
```

### Standalone Commands
```bash
# Check provider status
node llm-provider-manager.js status

# Set provider with fallback
node llm-provider-manager.js set together --fallback groq

# Compare pricing
node llm-provider-manager.js compare

# Test provider
node llm-provider-manager.js test
```

## Provider Comparison

| Provider | Input | Output | Speed | Free Tier |
|----------|-------|--------|-------|-----------|
| **Groq** | $0.15/M | $0.75/M | 500 tok/sec | ✅ 8K TPM |
| **Together AI** | $0.16/M | $0.60/M | Fast | ❌ Paid only |

### Cost Example (100 interactions/day)
- **Groq**: ~$1.00/month
- **Together AI**: ~$0.93/month  
- **Together AI + Batch**: ~$0.45/month ⭐ **CHEAPEST**

## Recommendations

### 🆓 For Free Usage
- **Use Groq free tier**
- Set fallback to Together AI for when you hit limits
- Use `/compact` to reduce token usage

### 💳 For Paid Usage  
- **Use Together AI** - Best pricing overall
- Enable batch API for 50% discount
- Set Groq as fallback for speed when needed

## Auto-Fallback Setup
```bash
# Set Together AI primary, Groq fallback
node llm-provider-manager.js set together --fallback groq

# Now if Together AI fails/limits, automatically uses Groq
node cognitron05-memgpt.js
```

## Troubleshooting

### "Failed to initialize provider"
1. Check API key is set: `echo $GROQ_API_KEY`
2. Test provider: `node llm-provider-manager.js test`
3. Try fallback provider: `node llm-provider-manager.js set groq`

### "Rate limit exceeded"
1. Switch to paid provider: `/provider together`  
2. Or use memory compaction: `/compact`
3. Or wait for rate limit reset

### "Invalid API response"
1. Check provider status online
2. Switch providers: `/provider groq` or `/provider together`
3. Auto-fallback will handle this if configured

## Configuration Files

The system stores configuration in:
- `./cognitron-memgpt-data/llm-config.json` - Provider settings
- Automatic backup and fallback handling
- Persistent across MemGPT sessions

## Getting API Keys

### Groq
1. Go to https://console.groq.com
2. Sign up for free account
3. Generate API key
4. Free tier: 30 requests/min, 8,000 tokens/min

### Together AI  
1. Go to https://api.together.xyz
2. Sign up and add payment method
3. Generate API key
4. $5 minimum credit, pay-as-you-go

Both providers use the same `openai/gpt-oss-120b` model!