# Cognitron05 MemGPT - Provider Versions

Two clean, simple versions without modular provider complexity:

## 🔄 **cognitron05-groq-only.js** (Recommended)
- **Provider**: Groq only
- **Model**: openai/gpt-oss-120b
- **Cost**: Free tier (30 RPM, 8K TPM)
- **Reliability**: ✅ **Fully working** with MemGPT
- **API Key**: `export GROQ_API_KEY="your-key"`

```bash
export GROQ_API_KEY="YOUR_GROQ_API_KEY_HERE"
node cognitron05-groq-only.js
```

## 🔄 **cognitron05-together-only.js** (Experimental)
- **Provider**: Together AI only
- **Model**: openai/gpt-oss-120b  
- **Cost**: $0.16/M input, $0.60/M output
- **Reliability**: ⚠️ **May timeout** with large MemGPT contexts
- **API Key**: `export TOGETHER_API_KEY="your-key"`

```bash
export TOGETHER_API_KEY="YOUR_TOGETHER_API_KEY_HERE"
node cognitron05-together-only.js
```

## 🔄 **cognitron05-memgpt.js** (Main - Currently Groq)
- Default main file (currently set to Groq-only version)

## Usage

Both versions support the same MemGPT commands:
- `/help` - Show commands
- `/memory` - Show memory state  
- `/compact` - Reduce context size
- `/clear` - Clear conversation
- `/reset` - Reset all memory
- `/exit` - Save and exit

## Comparison Results

| Feature | Groq Only | Together AI Only |
|---------|-----------|------------------|
| **Initialization** | ✅ Works | ✅ Works |
| **Simple API calls** | ✅ Works | ✅ Works |
| **Function calling** | ✅ Works | ✅ Works |
| **MemGPT complex context** | ✅ **Works reliably** | ❌ **Timeouts/fails** |
| **Cost** | Free | $10 credits |
| **Rate limits** | 30 RPM, 8K TPM | More generous |

## Recommendation

**Use `cognitron05-groq-only.js`** - it works perfectly with MemGPT's complex multi-message contexts and function calling.

Together AI works great for simple requests but has issues with MemGPT's large context windows (88+ messages with tools), even though they're under the 8K token limit.