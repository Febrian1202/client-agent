# Phase 4 — AI Agent: Step-by-Step Implementation Guide

> **Goal:** Introduce an LLM-powered AI agent orchestrated over explicit domain tools to summarize conversations and draft replies via an OpenAI-compatible endpoint (self-hosted 9router), enforcing strict anti-AI slop prompt hygiene, factual grounding, and audit logging in `agent_runs`.
>
> **Strict Constraints:**
> - **Human-in-the-Loop:** The AI agent NEVER sends messages directly to VGen or any external platform. It only generates summaries and drafts.
> - **OpenAI-Compatible Abstraction:** Built on a uniform client connecting to 9router / OpenAI-compatible APIs via configurable `AI_BASE_URL`, `AI_PROVIDER_API_KEY`, and `AI_MODEL`.
> - **Anti-AI Slop & Human Rhythm:**
>   - **No Repetitive Greetings:** Never repeat greetings or call out the client's name (*"Hi @client..."*) if the conversation is ongoing or within recent back-and-forth. Get straight to the point naturally.
>   - **Minimalist Emoji:** Maximum 1 relevant emoji (or 0 if unneeded). Never spam emojis.
>   - **Friendly to Minor Revisions:** Receptive and accommodating to minor tweaks (small layer cuts, layer separation adjustment), but never promises massive scope changes without creator instruction.
> - **Factuality & Zero Hallucination:** The agent must never invent facts, prices, dates, or conversation history. If context is ambiguous or target is uncertain, classify as `LOW_CONFIDENCE` and ask the creator for clarification.
> - **Auditability:** Every single LLM invocation must be recorded in the `agent_runs` table with token counts, latency, system version, input, and output.
>
> **Prerequisites:** Phase 3 (VGen Reader) completed.

---

## Architecture Context for This Phase

```text
Creator Instruction (Discord: /summarize or /reply)
       │
       ▼
packages/discord (Slash Command Handler)
       │ Defers reply immediately
       ▼
Redis Stream (client-agent:agent)
       │ Task: GENERATE_SUMMARY or GENERATE_REPLY_DRAFT
       ▼
apps/worker
       │
       ▼
packages/agent (Agent Orchestrator)
       │
       ├── Context Builder:
       │     ├─ System Base (VGen Creator Persona)
       │     ├─ Safety & Anti-Slop Rules (No robot greetings, ≤1 emoji, grounding)
       │     ├─ Creator Context & Guidelines (Live2D art cutting, layer separation)
       │     └─ Dynamic Conversation History (Retrieved messages from DB / live sync)
       │
       ├── Tool Registry:
       │     ├─ find_client
       │     ├─ get_conversation
       │     ├─ read_vgen_conversation
       │     ├─ summarize_conversation
       │     └─ draft_reply
       │
       └── packages/ai (OpenAI-compatible client / 9router)
             │ Calls 9router VPS endpoint: POST ${AI_BASE_URL}/chat/completions
             ▼
PostgreSQL: Record stored in 'agent_runs' table
  - task_id, provider, model, system_version, token_usage, duration_ms, input, output
       │
       ▼
Result delivered to Discord (Follow-up message edited with clean Embed)
```

---

## Atomic Task Breakdown

### Task 4.1: Database Schema & Migration for `agent_runs`
- [ ] In `packages/db/src/schema/agent_runs.ts`, define the `agent_runs` table:
  - `id`: `bigserial` primary key
  - `task_id`: `bigint` references `agent_tasks(id)` (nullable for ad-hoc runs)
  - `provider`: `text` not null (e.g. `'openai'`, `'9router'`)
  - `model`: `text` not null (e.g. `'claude-3-5-sonnet'`, custom 9router combo ID)
  - `system_version`: `text` not null default `'v1.0'`
  - `input`: `jsonb` not null (messages, system prompt, temperature, tools)
  - `output`: `jsonb` not null (content, tool_calls, finish_reason)
  - `prompt_tokens`: `integer` nullable
  - `completion_tokens`: `integer` nullable
  - `total_tokens`: `integer` nullable
  - `duration_ms`: `integer` not null
  - `status`: `text` not null (`'success'` | `'error'`)
  - `error_message`: `text` nullable
  - `created_at`: `timestamp with time zone` default `now()`
- [ ] Export `agent_runs` in `packages/db/src/schema/index.ts`.
- [ ] Add CRUD helper functions in `packages/db/src/queries/agentRuns.ts`:
  - `insertAgentRun(data: NewAgentRun): Promise<AgentRun>`
  - `getAgentRunsByTaskId(taskId: number): Promise<AgentRun[]>`
- [ ] Run migration: `bun run --filter=@client-agent/db db:generate && bun run --filter=@client-agent/db db:migrate`.

---

### Task 4.2: Config Schema Updates for OpenAI-Compatible / 9router
- [ ] In `packages/config/src/schema.ts`, expand configuration options:
  - `AI_BASE_URL`: `z.string().url().default('https://api.openai.com/v1')` (can point to self-hosted `http://<vps-ip>:<port>/v1` or custom 9router domain)
  - `AI_PROVIDER_API_KEY`: `z.string().min(1, 'AI_PROVIDER_API_KEY is required')`
  - `AI_MODEL`: `z.string().default('gpt-4o')`
  - `AI_TIMEOUT_MS`: `z.coerce.number().default(60000)`
  - `AI_MAX_RETRIES`: `z.coerce.number().default(2)`
- [ ] Update `.env.example` and pass variables into `infrastructure/docker-compose.yml`.

---

### Task 4.3: `packages/ai` (OpenAI-Compatible Provider Abstraction)
- [ ] Create `packages/ai/package.json` (`@client-agent/ai`) in Bun workspaces.
- [ ] Define provider interfaces in `packages/ai/src/types.ts`:
  - `ChatMessage`: role (`'system'` | `'user'` | `'assistant'` | `'tool'`), content, name, tool_calls.
  - `ChatCompletionOptions`: model, messages, temperature, maxTokens, tools, toolChoice.
  - `ChatCompletionResult`: content, toolCalls, usage (promptTokens, completionTokens, totalTokens), durationMs, model, finishReason.
- [ ] Implement `OpenAICompatibleClient` in `packages/ai/src/client.ts`:
  - Uses fetch or official OpenAI SDK with custom `baseURL` support.
  - Automatically records start/end time to calculate `durationMs`.
  - Normalizes usage and token counts.
  - Exponential backoff retry on 429 and 5xx errors.
- [ ] Implement unit tests in `packages/ai/tests/client.test.ts` with mocked HTTP routes verifying custom `baseURL`, headers, token tracking, and timeout handling.

---

### Task 4.4: `packages/agent` (Tool Registry & Contracts)
- [ ] Create `packages/agent/package.json` (`@client-agent/agent`) in Bun workspaces.
- [ ] Define typed tool definitions in `packages/agent/src/tools/definitions.ts`:
  - `find_client`: schema `{ username: string }` -> searches client in DB.
  - `get_conversation`: schema `{ clientUsername: string, limit?: number }` -> retrieves stored messages from DB.
  - `read_vgen_conversation`: schema `{ clientUsername: string }` -> live sync via `PlatformAdapter`.
  - `summarize_conversation`: schema `{ clientUsername: string }` -> compiles status and key details.
  - `draft_reply`: schema `{ clientUsername: string, instruction: string, tone?: string }` -> drafts response.
- [ ] Implement `ToolRegistry` and `ToolExecutor` in `packages/agent/src/tools/registry.ts`:
  - Maps tool invocations to real domain/database service calls.
  - Validates tool input arguments using Zod schemas.
  - Ensures tool calls are executed safely with strict error handling and audit logging.
- [ ] Unit tests in `packages/agent/tests/tools.test.ts`.

---

### Task 4.5: Prompt Architecture & Anti-Slop Persona Builder
- [ ] In `packages/agent/src/prompts/builder.ts`, implement layered prompt assembler:
  1. **Layer 1: Identity & Persona (Creator Voice)**
     - Role: Personal assistant representing an artist specializing in Live2D art cutting, layer separation, style-matching redraws, and animation on VGen.
     - Tone: Warm, relaxed, professional, authentic.
  2. **Layer 2: Anti-AI Slop & Conversation Rhythm Guard**
     - **Greeting Rhythm:** Do NOT open with greetings like *"Hi [Name]"* or *"Hello [Name]"* if the conversation is ongoing or messages were exchanged recently. Respond straight to the point naturally.
     - **Emoji Rule:** Maximum 1 relevant emoji per message, or none at all. Never stack or spam emojis.
     - **Revision Policy:** Receptive and accommodating to minor adjustments (e.g. separating smaller parts, tweaking hair cuts), but never promise extensive out-of-scope work or arbitrary discounts without explicit creator instruction.
  3. **Layer 3: Factuality & Safety Guard**
     - Never fabricate messages, prices, turnaround times, or delivery links.
     - If context is missing or ambiguous, return `confidence: "LOW"` with a request for clarification.
  4. **Layer 4: Conversation History Injection**
     - Format recent messages chronologically with sender, timestamp, and direction (`Inbound` / `Outbound`).
  5. **Layer 5: Task-Specific Prompt**
     - For `/summarize`: Instruct LLM to output structured JSON/bullet points:
       - **Status / Stage:** (e.g., Discussion, Proposal Sent, WIP, Delivered, Revision Requested)
       - **Key Details & Client Questions:** Bullet points of what the client wants/needs.
       - **Next Action for Creator:** Clear, actionable takeaway.
     - For `/reply`: Instruct LLM to generate the reply draft following the creator's instruction and voice.
- [ ] Unit tests in `packages/agent/tests/prompts.test.ts` verifying prompt rules and formatting.

---

### Task 4.6: Worker Task Handlers: Summary & Reply Draft
- [ ] In `packages/domain/src/index.ts`, define task types:
  - `TaskType.GENERATE_SUMMARY = 'GENERATE_SUMMARY'`
  - `TaskType.GENERATE_REPLY_DRAFT = 'GENERATE_REPLY_DRAFT'`
- [ ] In `packages/queue/src/streams.ts`, define `STREAMS.AGENT = 'client-agent:agent'`.
- [ ] Implement `apps/worker/src/handlers/generateSummary.ts`:
  - Loads client and conversation history from DB (or triggers live sync if empty).
  - Calls agent summary orchestrator.
  - Inserts record into `agent_runs`.
  - Edits Discord interaction / sends message to Discord channel with clean summary embed.
- [ ] Implement `apps/worker/src/handlers/generateReplyDraft.ts`:
  - Loads conversation history + creator instruction.
  - Calls agent reply orchestrator.
  - Inserts record into `agent_runs`.
  - Edits Discord interaction / sends message to Discord channel with draft preview embed.
- [ ] Register `STREAMS.AGENT` consumer in `apps/worker/src/index.ts`.

---

### Task 4.7: Discord Slash Commands: `/summarize` & `/reply`
- [ ] In `packages/discord/src/commands/summarize.ts`:
  - Slash command `/summarize username:<string>`.
  - Defers reply immediately (`"Analyzing conversation with @username... ⏳"`).
  - Enqueues `GENERATE_SUMMARY` task onto `STREAMS.AGENT`.
- [ ] In `packages/discord/src/commands/reply.ts`:
  - Slash command `/reply username:<string> instruction:<string>`.
  - Defers reply immediately (`"Drafting contextual reply for @username... ⏳"`).
  - Enqueues `GENERATE_REPLY_DRAFT` task onto `STREAMS.AGENT`.
- [ ] Register new commands in `packages/discord/src/bot.ts` and `apps/worker/src/bot.ts`.
- [ ] Unit & integration tests in `packages/discord/tests`.

---

## Verification & Testing Steps

1. **Provider Connectivity Test (9router Mock & Live):**
   - Verify `OpenAICompatibleClient` connects to the custom `AI_BASE_URL` with auth headers.
   - Test handling of network drops, 401 unauthorized, and 429 rate limit errors.

2. **Database Logging Verification (`agent_runs`):**
   - Run a test summarization and verify a corresponding row is inserted in `agent_runs`.
   - Check that `model`, `prompt_tokens`, `completion_tokens`, `duration_ms`, and `output` are correctly captured.

3. **Anti-Slop & Prompt Rhythm Test:**
   - Test with a conversation where the creator and client chatted 10 minutes ago.
   - Verify the drafted reply does NOT say *"Hi [Name]"* or *"Hello [Name]"*, but directly responds to the inquiry.
   - Verify emoji count is ≤ 1.

4. **Live Discord Slash Command Test:**
   - In `#vgen` channel, run:
     ```text
     /summarize username:erianosamu
     ```
     Verify Discord message is edited into a structured summary (Stage, Key Requests, Next Actions).
   - In `#vgen` channel, run:
     ```text
     /reply username:erianosamu instruction:katakan revisi choker dan badannya sudah beres dan file di Drive sudah diupdate
     ```
     Verify Discord message displays a natural, polite, to-the-point draft.

---

## Done When Checklist
- [ ] Database migration applied; `agent_runs` table exists and records every AI call.
- [ ] `packages/ai` provides a resilient OpenAI-compatible client supporting custom `AI_BASE_URL`.
- [ ] `packages/agent` enforces typed tools, layered prompts, and anti-AI-slop rules (natural greeting rhythm, ≤1 emoji).
- [ ] Worker processes `GENERATE_SUMMARY` and `GENERATE_REPLY_DRAFT` tasks via Redis Streams.
- [ ] Discord `/summarize` returns accurate, structured conversation summaries.
- [ ] Discord `/reply` drafts natural responses matching creator persona and specific instructions.
- [ ] Full test suite (`bun test`) and typecheck pass 100%.
