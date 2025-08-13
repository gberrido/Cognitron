# 🧠 Cognitron CLI Variants Guide

## CLI Options Available

You now have **4 different CLI variants** to choose from based on your needs:

### 1. **cognitron-readline.js** ✨ **RECOMMENDED**
**Best CLI experience with full readline support**

**Features:**
- ✅ **Arrow key history navigation** (↑/↓)
- ✅ **Tab completion** for commands
- ✅ **Command history** with `/history` command
- ✅ **Professional interface** with Commander.js
- ✅ **Multiple modes**: chat, ask, status, models
- ✅ **Continuous conversation**
- ✅ **Memory system integration**

**Usage:**
```bash
./cognitron-readline.js                    # Interactive chat (default)
./cognitron-readline.js ask "Question?"    # Single question
./cognitron-readline.js status             # System status
./cognitron-readline.js models             # Available models
./cognitron-readline.js --help             # Full help
```

**Best for:** Daily use, development, professional workflows

---

### 2. **cognitron.js** 
**Professional CLI without readline (raw stdin)**

**Features:**
- ✅ **Professional interface** with Commander.js
- ✅ **Multiple modes**: chat, ask, status, models
- ✅ **Continuous conversation**
- ✅ **Memory system integration**
- ❌ No arrow key navigation
- ❌ No command history

**Usage:**
```bash
./cognitron.js                    # Interactive chat
./cognitron.js ask "Question?"    # Single question  
./cognitron.js --help             # Full help
```

**Best for:** Systems without TTY support, automated scripts

---

### 3. **simple-cli.js**
**Minimal, reliable CLI**

**Features:**
- ✅ **Maximum compatibility** (raw process.stdin)
- ✅ **Continuous conversation**
- ✅ **Basic commands**: /help, /memory, /status, /exit
- ✅ **Simple interface**
- ❌ No Commander.js features
- ❌ No arrow key navigation
- ❌ Limited commands

**Usage:**
```bash
./simple-cli.js    # Interactive chat only
```

**Best for:** Testing, debugging, maximum compatibility

---

### 4. **src/cli.js** 
**Original full-featured CLI**

**Features:**
- ✅ **All advanced features** (models, memory, sessions)
- ✅ **WebSocket support** 
- ✅ **Original readline interface**
- ⚠️ **May have TTY issues** in some environments
- ⚠️ **Complex interface**

**Usage:**
```bash
./src/cli.js    # Full-featured chat
```

**Best for:** Advanced users, full feature access

---

## Quick Comparison

| Feature | cognitron-readline | cognitron | simple-cli | src/cli |
|---------|-------------------|-----------|------------|---------|
| Arrow Keys (↑/↓) | ✅ | ❌ | ❌ | ✅* |
| Tab Completion | ✅ | ❌ | ❌ | ❌ |
| Command History | ✅ | ❌ | ❌ | ❌ |
| Commander.js | ✅ | ✅ | ❌ | ✅ |
| Single Questions | ✅ | ✅ | ❌ | ❌ |
| System Commands | ✅ | ✅ | Basic | Full |
| Continuous Chat | ✅ | ✅ | ✅ | ✅* |
| TTY Compatibility | ✅ | ✅ | ✅ | ⚠️ |
| Memory Integration | ✅ | ✅ | ✅ | ✅ |

*May have issues in some environments

---

## Recommended Usage

### For Daily Use
```bash
# Use the readline-enhanced version
./cognitron-readline.js
```

### For Quick Questions
```bash
./cognitron-readline.js ask "What is AI?"
./cognitron-readline.js ask "Explain Python" --verbose
```

### For System Monitoring
```bash
./cognitron-readline.js status
./cognitron-readline.js models
```

### For Maximum Compatibility
```bash
# If readline version has issues
./simple-cli.js
```

---

## Key Features of Recommended CLI

### ↑/↓ Arrow Key Navigation
- Navigate through previous commands
- Automatic history deduplication
- 100 command history limit

### Tab Completion  
- Auto-complete slash commands
- Intelligent command suggestions

### Command History
```bash
> Hello, how are you?
> What is JavaScript?
> /history
📜 Command History:
──────────────────────────────
  1: Hello, how are you?
  2: What is JavaScript?
  3: /history
Use ↑/↓ arrow keys to navigate history
```

### Professional Interface
- Colored output for better readability
- Clear status indicators  
- Comprehensive help system
- Error recovery with suggestions

---

## Installation Tips

### Make Executable
```bash
chmod +x cognitron-readline.js
```

### Create Aliases
Add to your `.bashrc` or `.zshrc`:
```bash
alias cog="./cognitron-readline.js"
alias cogask="./cognitron-readline.js ask"
alias cogstatus="./cognitron-readline.js status"
```

### Package Scripts
Available npm scripts:
```bash
npm start           # cognitron-readline.js (recommended)
npm run dev         # cognitron-readline.js --verbose  
npm run basic       # cognitron.js (no readline)
npm run simple      # simple-cli.js (minimal)
```

---

## Migration Guide

**From simple-cli.js → cognitron-readline.js:**
- All commands work the same
- Added arrow key navigation
- Added tab completion
- Added `/history` command
- Same continuous conversation experience

**From src/cli.js → cognitron-readline.js:**
- More reliable TTY handling
- Better command structure
- Added history navigation
- Same advanced features
- Improved user experience

---

## Troubleshooting

### Arrow Keys Not Working
1. Ensure you're using `cognitron-readline.js`
2. Check terminal compatibility: `echo $TERM`
3. Try in a different terminal (Terminal.app, iTerm2, etc.)

### TTY Issues
1. Use `simple-cli.js` for maximum compatibility
2. Check with: `tty` command
3. Ensure terminal supports ANSI colors

### Command Not Found
1. Make executable: `chmod +x cognitron-readline.js`  
2. Use full path: `./cognitron-readline.js`
3. Check file permissions

---

## Summary

**🎯 For the best experience, use `cognitron-readline.js`** - it has all the features you need including arrow key navigation, tab completion, and a professional interface!

The arrow keys (↑/↓) will now work perfectly for navigating your command history! 🚀