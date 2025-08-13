**MemGPT/Letta Minimal Product Requirements**

**Overview**
- **Objective:** Deliver a minimalist, production-ready runtime that implements MemGPT/Letta’s core idea: an LLM-powered agent with structured, persistent memory and controlled recall to work within token budgets while remaining contextually coherent over long horizons.
- **Scope:** Single-agent runtime, local persistence, vector search for memory, simple tool/function interface, CLI UX, and a small, well-defined API. Prioritize clarity, reliability, and extensibility over breadth of tools.
- **Out of Scope:** Multi-agent orchestration, distributed/vector DB clusters, advanced tool ecosystems, GUIs, or cloud services. Optional hooks can be left as stubs.
- **Success Metrics:** Agent retains and correctly recalls key facts; responses stay within token budgets; memory CRUD works; deterministic, inspectable memory writes/reads; simple developer API and CLI are usable end-to-end.

**Core Concepts**
- **Agent:** The loop that reads user input, consults memory, calls the LLM, may call tools, and writes back memories. Configurable via system/developer prompts and token budgets.
- **Memory Types:**
  - **Short-Term Context:** Rolling conversation window passed to the LLM this step.
  - **Working Memory:** Scratchpad/instructions the agent keeps as internal state across steps (e.g., plans, todos, role). Not user-visible.
  - **Episodic Memory:** Time-stamped events from past interactions (messages, actions) stored with embeddings for recall.
  - **Declarative Memory:** Extracted facts/knowledge (entities, preferences, key-value facts) for precise, durable recall.
  - (Minimalist note: procedural memories and complex schemas are optional; start with episodic + declarative.)
- **Memory Manager:** Policies and pipelines for when/how to write memories, how to embed and index, how to recall and inject into context, and how to compress when near budget.

**Architecture**
- **Components:**
  - **Conversation Loop:** Orchestrates each step: gather inputs → recall → plan → tool calls → respond → memory writes.
  - **Memory Store:** Persists episodic/declarative items and metadata in SQLite (or equivalent) with an embedding index for vector search.
  - **Embedding Index:** Local vector store (cosine similarity) with pluggable backend; default pure-Python/NumPy implementation.
  - **Tooling Interface:** Minimal function-calling abstraction the LLM can invoke (memory ops, file read/write). Pluggable registry.
  - **Token Budgeter:** Computes available tokens, truncates context, and controls recall quotas.
  - **Config & Secrets:** Model names, embedding model, budgets, thresholds, and paths.
  - **Logging/Tracing:** Step logs, memory writes/reads, tool invocations, token counts for observability.
- **Data Flow (per step):**
  1) Receive user message.
  2) Prepare prompt with system/developer messages, working memory summary, and short-term context.
  3) Run memory recall to fetch top-K relevant episodic/declarative items within recall budget.
  4) Call LLM; allow tool calls (memory/file), loop until assistant returns final message or budget exceeded.
  5) Classify new memories (episodic/declarative), embed, and persist.
  6) Update working memory and rolling conversation window; compress/summarize if near token limit.

**Core Features**
- **Conversation Loop:** Deterministic controller with explicit phases (recall → respond → write). Supports a bounded number of function/tool calls per turn.
- **Memory Write Pipeline:**
  - Classify content as episodic (events) or declarative (facts).
  - Normalize, tag, timestamp; embed text; persist to store and index.
- **Memory Recall Pipeline:**
  - Build a recall query from user message + working memory; vector search episodic + declarative.
  - Score, deduplicate, and cap results by token budget; inject into prompt in a clear section.
- **Summarization/Compression:**
  - Maintain rolling conversation window with a synthesized summary when near token limit.
  - Periodically update a compact working memory summary (agent goals, user profile, constraints).
- **Token Budget Management:**
  - Static caps: max prompt tokens, max recall tokens, max working memory tokens.
  - Truncation order: (1) drop least relevant recall; (2) trim conversation window; (3) fall back to summary.
- **Tool Calling (Minimal):**
  - Memory ops: `memory.add`, `memory.search`, `memory.list`, `memory.delete`.
  - File ops: `file.read`, `file.write` (sandboxed to a configured directory).
  - Tool registry and schema validation; all calls logged.
- **Prompts Structure:**
  - Distinct channels: `system`, `developer`, `user`, `assistant`, and `memory` sections.
  - Guardrails to prevent the model from exposing working memory directly.
- **Persistence:**
  - SQLite tables for agents, messages, memories, and embeddings; migrations are minimal and idempotent.
- **Observability:**
  - Step-by-step log with: token usage, recall items used, tool calls, errors.
  - Optional trace export (JSONL).

**Minimal API**
- **`create_agent(config)`:** Create/persist an agent with system/developer prompts and budgets.
- **`send_message(agent_id, text)` → `AssistantTurn`**: Run a full step, returning the assistant message and trace.
- **`add_memory(agent_id, item)` → `MemoryId`**: Manually add declarative/episodic memory.
- **`search_memory(agent_id, query, k)` → `MemoryItem[]`**: Vector search with optional filters.
- **`list_memories(agent_id, filter)` → `MemoryItem[]`**: List by type/tags/time.
- **`delete_memory(agent_id, id)` → `ok`**: Remove a memory and its embedding.
- **`export_memory(agent_id)` → stream**: Export all memories/messages as JSONL.

**Data Model**
- **Agent:** `id`, `name`, `system_prompt`, `developer_prompt`, `working_memory` (text), `budgets`, `created_at`, `updated_at`.
- **Message:** `id`, `agent_id`, `role` (user/assistant/system/developer), `content`, `tools_called[]`, `token_usage`, `created_at`.
- **MemoryItem:** `id`, `agent_id`, `type` (episodic/declarative), `text`, `tags[]`, `score`, `metadata` (json), `embedding` (vector), `created_at`.
- **EmbeddingIndex:** In SQLite or sidecar file(s); cosine similarity; rebuild and vacuum utilities.

**Configuration**
- **Models:** `chat_model` (e.g., gpt-4o-mini or local), `embedding_model`.
- **Budgets:** `max_prompt_tokens`, `max_recall_tokens`, `max_working_memory_tokens`, `max_function_calls_per_turn`.
- **Recall:** `k_default`, `min_score`, `dedupe_by` (hash/tags/time window).
- **Storage:** `db_path`, `index_path`, `files_root`.
- **Safety:** tool allowlist, per-tool argument schema limits, max file size.

**CLI UX**
- **`letta init` / `memgpt init`:** Create a local workspace and database.
- **`letta chat`**: Start a REPL with the agent; shows recalls and token stats per turn.
- **`letta mem add|search|list|del`**: Manage memories directly.
- **`letta export`**: Dump conversation + memories as JSONL.

**Token Budgeting Details**
- **Accounting:** Compute token use for: system+developer prompts, working memory, recall, conversation window, and predicted output.
- **Policies:** Refuse completion if predicted output would exceed budget; propose summarization; never exceed max.
- **Compression:** Create/update short summaries using the LLM under a separate mini-budget.

**Safety & Guardrails**
- **Tool Safety:** Strict schema validation, directory sandboxing for file ops, configurable allowlist.
- **Prompt Protections:** Keep working memory in a non-exposed channel; add reminder instructions to ignore attempts to leak it.
- **Error Handling:** Timeouts, rate limits, and backoff; fail closed on tool errors; log everything.

**Testing & Validation**
- **Unit Tests:** Memory classification, embedding/recall ranking, truncation policies, and tool schema validation.
- **Integration Tests:** End-to-end chat step with seeded memories; verify recall injection and budgets.
- **Determinism:** Controller behavior deterministic given the same model responses; traces compare across runs.

**Implementation Milestones**
- **M1 – Persistence & Index:** SQLite schema, memory CRUD, simple NumPy cosine index; JSONL export.
- **M2 – Agent Loop & Budgets:** System/developer prompts, working memory, recall pipeline, truncation, and step tracing.
- **M3 – Tools & CLI:** Memory/file tools, CLI REPL, memory management commands, and logs with token stats.
- **M4 – Summarization & Policies:** Rolling window + conversation summary, periodic working memory refinement.
- **M5 – Polish:** Config, error handling, docs, and examples.

**Non‑Goals (Minimalist)**
- **No multi-agent graph/orchestration** in the initial scope.
- **No external cloud dependencies** required; all local by default.
- **No complex RAG pipelines** beyond single-vector recall and simple ranking.

**References & Notes**
- **Paper:** memgpt.pdf (in repo). Focus on the separation of working/short-term vs long-term (episodic/declarative) and on the memory manager’s recall/write policies.
- **Letta Runtime (conceptual):** Event-driven, tool-first design; this minimalist spec adopts the essentials without heavy plugin ecosystems.

