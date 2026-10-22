# Phase 8 — Client Memory: Step-by-Step Implementation Guide

> **Goal:** Equip the AI agent with structured long-term memory for clients, enabling it to remember preferences, project details, and communication habits while strictly distinguishing verified facts from speculative inferences.
> **Core Constraint:** The agent must NEVER present an `INFERENCE` as a known `FACT`.
> **Prerequisites:** Phases 4 and 7 completed.

---

## Memory Taxonomy

```text
┌────────────────────────────────────────────────────────┐
│                   CLIENT MEMORY TYPES                  │
├───────────────┬────────────────────────────────────────┤
│ FACT          │ Explicitly confirmed information.       │
│               │ Examples: Preferred language (English),│
│               │ timezone (PST), character sheet link. │
├───────────────┼────────────────────────────────────────┤
│ PREFERENCE    │ Recurring patterns observed over time. │
│               │ Examples: Prefers sketches before line │
│               │ art, likes cel-shaded rendering style. │
├───────────────┼────────────────────────────────────────┤
│ INFERENCE     │ Agent deduction / hypothesis.          │
│               │ Examples: Might want commercial rights │
│               │ based on inquiry wording.               │
└───────────────┴────────────────────────────────────────┘
```

---

## Atomic Task Breakdown

### Task 8.1: Database Schema for Client Memory
- [x] In `packages/db/src/schema/client_memories.ts`, define `client_memories` table:
  - `id`: `bigserial` primary key
  - `client_id`: `bigint` references `clients(id)` on delete cascade
  - `type`: `text` not null (`fact`, `preference`, `inference`)
  - `category`: `text` not null (`technical`, `scope`, `assets`, `communication`, `general`)
  - `content`: `text` not null (e.g. `"Uses VTube Studio on iOS tracking. Model was created with Live2D Cubism 5.0."`)
  - `source`: `text` not null (`user_note`, `conversation_extraction`, `agent_inference`)
  - `confidence`: `text` default `'high'` (`high`, `medium`, `low`)
  - `created_at`, `updated_at`: `timestamp with time zone` default `now()`
- [x] Run migration: `bun run --filter=@client-agent/db db:generate && bun run --filter=@client-agent/db db:migrate`.

---

### Task 8.2: Memory Extraction & Persistence Service in `packages/domain`
- [x] In `packages/domain/src/services/memoryService.ts`:
  - `addMemory({ clientId, type, category, content, source, confidence })`:
    - Inserts new memory record.
  - `getClientMemories(clientId: number)`:
    - Returns grouped memories categorized by `FACT`, `PREFERENCE`, and `INFERENCE`.
  - `deleteMemory(memoryId: number)`:
    - Removes memory record.
  - `updateMemory(memoryId: number, content: string)`:
    - Allows manual edit by creator.

---

### Task 8.3: Context Builder Injection in `packages/agent`
- [x] In `packages/agent/src/prompts/builder.ts`:
  - Enhance context assembler to load memories for target client:
    ```text
    CLIENT BACKGROUND & MEMORY:
    [VERIFIED FACTS]
    - Primary Language: English
    - Reference link: https://vgen.co/...
    - Timezone: UTC+9

    [KNOWN PREFERENCES]
    - Prefers rough sketches before ink stage

    [AI INFERENCES - NOT VERIFIED FACTS]
    - Likely planning a VTuber debut based on recent outfit mentions (Verify before assuming!)
    ```
  - Prompt instructions to LLM:
    `Use verified facts and known preferences to personalize your draft. If referencing an inference, phrase it gently as a question, never as an established fact.`

---

### Task 8.4: Memory Management API Endpoints in `apps/api`
- [x] In `apps/api/src/routes/clients.ts`:
  - `GET /api/v1/clients/:id/memories` — List all memories for client.
  - `POST /api/v1/clients/:id/memories` — Add a new manual fact or preference.
  - `PATCH /api/v1/clients/:id/memories/:memoryId` — Update memory text.
  - `DELETE /api/v1/clients/:id/memories/:memoryId` — Remove memory record.

---

### Task 8.5: SvelteKit Memory UI on Client Details Page
- [x] In `apps/web/src/routes/clients/[id]/+page.svelte`:
  - Add "Client Memory & Notes" section:
    - Fact badges (Green outline)
    - Preference badges (Blue outline)
    - Inference badges (Yellow dashed outline)
  - "Add Fact / Note" dialog:
    - Dropdown for Type (`Fact`, `Preference`)
    - Category selector
    - Text area for content
  - Delete and Edit buttons per memory item.

---

## Verification & Testing Steps

1. **Memory Isolation & Type Distinction Test:**
   - Add a fact: `"Client's OC hair color is pastel violet."`
   - Add an inference: `"Client might be launching a stream next month."`
   - Request AI draft via `/reply`: `"Draft a quick check-in about the character colors"`.
   - Verify prompt output:
     - The AI accurately references the hair color as established fact.
     - The AI does NOT say `"Good luck with your stream next month!"` as a fact, but may ask if they have an upcoming debut.

2. **Web Management Test:**
   - Open `/clients/[id]` on the dashboard.
   - Add a note: `"Prefers payment in USD."`
   - Confirm it renders instantly in the Facts column.
   - Edit the note, then delete it. Verify database updates accordingly.

---

## Done When Checklist
- [x] `client_memories` table stores categorized memory records with source and confidence metadata.
- [x] Agent context builder correctly formats memory blocks, strictly separating `FACT` from `INFERENCE`.
- [x] Draft generation noticeably reflects stored client preferences without hallucinating unfounded claims.
- [x] Web dashboard allows the creator to view, add, edit, and delete client memories cleanly.

