# Phase 4 — AI Agent: Step-by-Step Implementation Guide

> **Goal:** Introduce AI orchestration over explicit domain tools to summarize conversations and draft replies, recording every execution in `agent_runs` for auditability and quality evaluation.
> **Strict Constraints:**
> - The AI agent never directly modifies database tables or sends messages on external platforms.
> - The agent communicates only through typed tool calls.
> - The agent must never invent facts or conversation history.
> - If context is ambiguous or target is uncertain, the agent must ask for clarification (`LOW_CONFIDENCE`).
> **Prerequisites:** Phase 3 completed.

---

## Architecture Context for This Phase

```text
Creator Instruction (Discord: /summarize or /reply)
       │
       ▼
Elysia API (POST /api/v1/agent/run)
       │
       ▼
Redis Stream (client-agent:agent)
       │
       ▼
Bun Worker
       │
       ▼
packages/agent (Agent Core Orchestrator)
       │
       ├── Context Builder:
       │     Base Rules + Safety Rules + Creator Prefs + Conversation Context
       │
       ├── Tool Registry:
       │     - find_client
       │     - get_conversation
       │     - read_vgen_conversation
       │     - summarize_conversation
       │     - draft_reply
       │
       └── packages/ai (Provider Abstraction: Vercel AI SDK or direct provider)
             │ Calls LLM (Claude / GPT / Gemini via config)
             ▼
Agent Execution Record saved to 'agent_runs' table
  - prompt version, model, duration_ms, token_usage, input/output
       │
       ▼
Result delivered to Discord / API
```

---

## Atomic Task Breakdown

### Task 4.1: Database Schema for `agent_runs`
- [ ] In `packages/db/src/schema/agent_runs.ts`, define `agent_runs` table:
  - `id`: `bigserial` primary key
  - `task_id`: `bigint` references `agent_tasks(id)`
  - `provider`: `text` (e.g. `'anthropic'`, `'openai'`)
  - `model`: `text` (e.g. `'claude-3-5-sonnet-20241022'`)
  - `system_version`: `text` (e.g. `'v1.0'`)
  - `input`: `jsonb` (prompt, tool definitions, parameters)
  - `output`: `jsonb` (LLM response, tool calls, text)
  - `token_usage`: `integer` nullable
  - `duration_ms`: `integer` nullable
  - `status`: `text` (`success`, `error`)
  - `created_at`, `updated_at`: `timestamp with time zone`
- [ ] Run migration: `bun run --filter=@client-agent/db db:generate && bun run --filter=@client-agent/db db:migrate`.

---

### Task 4.2: `packages/ai` (LLM Provider Abstraction)
- [ ] Create `packages/ai/package.json` (name: `@client-agent/ai`).
- [ ] Provide unified client wrapping modern AI SDK (e.g. `ai` / Vercel AI SDK or `@google/genai` / `@anthropic-ai/sdk`):
  - Function `generateText(options: GenerateTextOptions): Promise<GenerateTextResult>`
  - Function `streamText(options: StreamTextOptions): Promise<StreamTextResult>`
- [ ] Track metadata: token usage, latency (ms), model used.
- [ ] Read credentials from `@client-agent/config`: `AI_PROVIDER_API_KEY`, `AI_MODEL`.

---

### Task 4.3: `packages/agent` (Tool Registry & Contracts)
- [ ] Create `packages/agent/package.json` (name: `@client-agent/agent`).
- [ ] Implement Tool Definitions with schemas:
  - `find_client`: schema `{ query: string }`
  - `get_conversation`: schema `{ clientId: number }`
  - `read_vgen_conversation`: schema `{ clientUsername: string }`
  - `summarize_conversation`: schema `{ conversationId: number }`
  - `draft_reply`: schema `{ conversationId: number, instruction: string, tone?: string }`
- [ ] Implement Tool Executor:
  - Maps tool invocations to real domain/database service calls.
  - Ensures tool calls are executed with validation and proper error trapping.

---

### Task 4.4: Prompt Architecture & Context Builder
- [ ] In `packages/agent/src/prompts/builder.ts`:
  - Assemble layered prompt structure:
    1. **System Base:**
       `You are a client communication assistant for an art creator on VGen. You help monitor, summarize, and draft replies to client inquiries.`
    2. **Safety Rules:**
       `Never fabricate message content or dates. Never send messages externally without explicit human approval. If client target or intent is ambiguous, classify as LOW_CONFIDENCE and ask for clarification.`
    3. **Creator Preferences:**
       `Tone: concise, friendly, warm, professional. Keep sentences clear. Avoid corporate jargon.`
    4. **Conversation Context:**
       Inject recent messages: `[2026-10-15 10:00] Client: Can you do commercial use? ...`
    5. **Current Instruction:**
       User instruction from Discord/API: `"Tell them commercial use is +50%."`

---

### Task 4.5: Worker Task Handlers for Summary & Drafts
- [ ] In `apps/worker/src/handlers/generateSummary.ts`:
  - Task type: `GENERATE_SUMMARY`
  - Load conversation and last 20 messages.
  - Invoke AI agent with summarization prompt.
  - Record execution in `agent_runs` table.
  - Store summary text in `conversations.metadata` or return as task output.
- [ ] In `apps/worker/src/handlers/generateReplyDraft.ts`:
  - Task type: `GENERATE_REPLY_DRAFT`
  - Load conversation history and user instruction.
  - Invoke AI agent to generate draft content.
  - Record execution in `agent_runs` table.
  - Store draft in database (see Phase 5 for full approval lifecycle).

---

### Task 4.6: Discord Slash Commands: `/summarize` and `/reply`
- [ ] Implement `/summarize <username>`:
  - Defer reply.
  - Trigger `GENERATE_SUMMARY` task.
  - Display clean bulleted summary in Discord embed:
    - Current commission / inquiry status
    - Key questions or requests from client
    - Deadlines or special notes
- [ ] Implement `/reply <username> <instruction>`:
  - Defer reply.
  - Trigger `GENERATE_REPLY_DRAFT` task.
  - Show generated draft text in Discord embed (ready for Phase 5 approval workflow).

---

## Verification & Testing Steps

1. **Unit Test Tool Schema Validation:**
   - Test tool calling functions with invalid arguments (e.g. empty strings, missing IDs).
   - Verify schemas fail fast with validation errors.

2. **Summarization Test:**
   - Populate test conversation with 5 back-and-forth messages discussing commission scope and deadline.
   - Run `/summarize <username>` via Discord or API.
   - Verify output: concise 2-3 bullet point summary accurately reflecting the conversation content.
   - Inspect `agent_runs` table: confirm model name, token usage, latency, and system version are saved.

3. **Hallucination & Confidence Guard Test:**
   - Ask agent to draft a reply for a client with no conversation history or an ambiguous name.
   - Verify agent replies asking for clarification rather than hallucinating details.

---

## Done When Checklist
- [ ] `packages/ai` abstracts LLM calling behind a uniform interface.
- [ ] `packages/agent` defines explicit, typed tools without direct database mutation.
- [ ] Prompt layers enforce safety rules, creator preferences, and factual grounding.
- [ ] `/summarize` command returns accurate conversation summaries.
- [ ] `/reply` command produces contextual drafts matching creator instructions.
- [ ] Every LLM interaction creates a row in `agent_runs` with token count and execution duration.
