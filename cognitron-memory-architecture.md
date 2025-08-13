# Cognitron Memory Architecture

## 🧠 **Memory System Overview**

Cognitron uses a **multi-layered memory architecture** that combines **session-based in-memory storage** with **persistent file-based storage** for different purposes.

---

## 🏗️ **Architecture Layers**

### **Layer 1: Session Memory (In-Memory)**
*Used by cognitron00.js and cognitron00-minimal.js*

#### **Structure:**
```javascript
const conversationHistory = [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi there!" },
  { role: "user", content: "What's 2+2?" },
  { role: "assistant", content: "4" }
  // ... continues in chronological order
];
```

#### **Characteristics:**
- **Type:** Array of message objects
- **Scope:** Single session only
- **Persistence:** Lost when program exits
- **Management:** Smart context window management
- **Capacity:** Dynamic based on token limits

#### **Memory Management:**
```javascript
function manageConversationHistory(conversationHistory, systemMessage, limitPercent) {
  const maxHistoryTokens = Math.floor((CONFIG.CONTEXT_WINDOW * limitPercent) / 100);
  
  // Remove oldest pairs (user + assistant) when limit exceeded
  while (totalTokens > maxHistoryTokens) {
    conversationHistory.splice(0, 2); // Remove oldest pair
  }
}
```

### **Layer 2: Persistent Memory System (File-Based)**
*Available in cognitron03.js and later versions*

#### **File Structure:**
```
conversations/
├── 2025-08-06.jsonl          # Daily conversation logs
├── search-index.json         # Search index with term mapping
└── user-patterns.json        # User preference patterns
```

#### **JSONL Format (conversations/YYYY-MM-DD.jsonl):**
```jsonl
{"id": 12345, "timestamp": "2025-08-06T10:30:00Z", "session": "sess_001", "role": "user", "content": "Hello"}
{"id": 12346, "timestamp": "2025-08-06T10:30:01Z", "session": "sess_001", "role": "assistant", "content": "Hi there!"}
{"id": 12347, "timestamp": "2025-08-06T10:31:00Z", "session": "sess_002", "role": "user", "content": "What's AI?"}
```

#### **Search Index Structure:**
```json
{
  "terms": {
    "ai": [12347, 12350, 12355],
    "machine": [12360, 12365],
    "learning": [12360, 12365, 12370]
  },
  "sessions": {
    "sess_001": [12345, 12346],
    "sess_002": [12347, 12348]
  },
  "recent": [12370, 12365, 12360]
}
```

---

## 📊 **Memory Specifications**

### **Context Window Management**

| Component | Default | Range | Description |
|-----------|---------|-------|-------------|
| **Context Window** | 131,072 tokens | Fixed | Total API limit (128K) |
| **History Limit** | 50% | 10%-90% | % of context for conversation |
| **System Message** | ~200 tokens | Variable | Includes persona content |
| **Current Message** | Variable | Max 8,192 | User input + formatting |
| **Available History** | ~65,000 tokens | Dynamic | Remaining for conversation |

### **Token Estimation:**
```javascript
function estimateTokenCount(text) {
  return Math.ceil(text.length / 4); // ~4 chars per token
}
```

### **Memory Optimization:**
- **FIFO Removal:** Oldest messages removed first
- **Pair Removal:** User+Assistant removed together to maintain context
- **Smart Limits:** Adjustable percentage-based limits
- **Real-time Monitoring:** Token usage tracked continuously

---

## 🔄 **Memory Operations**

### **Session Memory Operations:**

#### **1. Add Message:**
```javascript
conversationHistory.push({ role: "user", content: message });
conversationHistory.push({ role: "assistant", content: response });
```

#### **2. Context Check:**
```javascript
const usage = calculateContextUsage(conversationHistory, systemMessage);
if (usage.usagePercentage > 80) {
  // Warning: High usage
}
```

#### **3. History Pruning:**
```javascript
while (totalTokens > maxHistoryTokens) {
  conversationHistory.splice(0, 2); // Remove oldest pair
}
```

#### **4. Clear Memory:**
```javascript
conversationHistory.length = 0; // Full reset
```

### **Persistent Memory Operations (cognitron03+):**

#### **1. Log Message:**
```javascript
const logEntry = {
  id: generateId(),
  timestamp: new Date().toISOString(),
  session: sessionId,
  role: message.role,
  content: message.content
};
appendToJSONL(logEntry);
```

#### **2. Search History:**
```javascript
const results = searchConversationHistory("machine learning", {
  limit: 10,
  dateRange: "last-week"
});
```

#### **3. Build Index:**
```javascript
const index = {
  terms: extractTerms(conversations),
  sessions: groupBySessions(conversations),
  recent: getRecentMessages(50)
};
```

---

## 🎯 **Memory Usage Patterns**

### **Typical Session Flow:**

1. **Startup:** `conversationHistory = []`
2. **User Input:** Add user message
3. **AI Response:** Add assistant message  
4. **Context Check:** Monitor token usage
5. **Auto-Prune:** Remove old messages if needed
6. **Repeat:** Continue until exit

### **Memory Growth Example:**
```
Start:     []
Turn 1:    [user, assistant]                    (~100 tokens)
Turn 5:    [user, assistant, ..., user, assistant] (~500 tokens)
Turn 20:   [user, assistant, ..., user, assistant] (~2000 tokens)
Prune:     [user, assistant, ..., user, assistant] (~1500 tokens)
Continue:  [user, assistant, ..., user, assistant] (~1600 tokens)
```

---

## 🛡️ **Memory Safety & Limits**

### **Protection Mechanisms:**

#### **1. Context Overflow Protection:**
```javascript
if (usage.totalTokens > CONFIG.CONTEXT_WINDOW) {
  // Emergency pruning
  conversationHistory.splice(0, conversationHistory.length / 2);
}
```

#### **2. Minimum History Protection:**
```javascript
if (conversationHistory.length < 2) {
  break; // Don't remove last exchange
}
```

#### **3. Token Estimation Accuracy:**
- Uses conservative 4 chars/token estimate
- Adds buffer for role/formatting tokens
- Real-time recalculation on changes

#### **4. User Control:**
```bash
/limit 75        # Set to 75% of context window
/stats           # Show current usage
/clear           # Manual reset
/history         # View current memory
```

---

## 📈 **Memory Performance**

### **Session Memory (Both Versions):**
| Operation | Time Complexity | Space Complexity |
|-----------|----------------|------------------|
| **Add Message** | O(1) | O(n) |
| **Token Count** | O(n) | O(1) |
| **Prune History** | O(n) | O(1) |
| **Clear All** | O(1) | O(1) |
| **Search History** | O(n) | O(1) |

### **Memory Footprint:**
- **Empty Session:** ~10MB (Node.js overhead)
- **Typical Session:** ~15-20MB (50 exchanges)
- **Large Session:** ~25-30MB (200 exchanges)
- **Context Full:** ~35-40MB (max capacity)

---

## 🎭 **Memory + Personas**

### **Persona Integration:**
```javascript
function createSystemMessage(reasoningLevel = 'low') {
  let baseMessage = "You are Cognitron...";
  
  if (personaContent) {
    baseMessage += " From now on you are this persona: " + personaContent;
  }
  
  return baseMessage; // This goes into context calculation
}
```

### **Impact on Memory:**
- **Persona Size:** ~1-5KB typical persona file
- **Token Cost:** ~200-1000 tokens per session
- **Context Usage:** Reduces available conversation history
- **Persistence:** Persona content repeated in every API call

---

## 🔍 **Advanced Memory Features (cognitron03+)**

### **1. Cross-Session Memory:**
- Persistent storage across sessions
- Search previous conversations
- User pattern learning
- Long-term context building

### **2. Semantic Indexing:**
- Keyword extraction and mapping
- Relevance scoring for search
- Topic clustering and retrieval
- Conversation threading

### **3. Memory Commands:**
```bash
/search "machine learning"    # Search conversation history
/memory                       # Show memory status
/recall "neural networks"     # Find related discussions
```

---

## 🎯 **Summary**

**Current cognitron00.js & cognitron00-minimal.js use:**
- ✅ **Session-based in-memory storage** (temporary)
- ✅ **Smart context window management** (token-based)
- ✅ **Real-time memory optimization** (auto-pruning)
- ✅ **User memory controls** (/limit, /clear, /stats)

**Advanced versions (cognitron03+) also have:**
- ✅ **Persistent file-based storage** (permanent)  
- ✅ **Cross-session search capabilities** (JSONL + indexing)
- ✅ **Conversation analytics** (patterns, insights)
- ✅ **Long-term memory building** (accumulative learning)

The memory system is designed to be **efficient, user-controlled, and context-aware** while providing both immediate session continuity and optional long-term persistence! 🧠✨