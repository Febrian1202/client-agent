# Phase 8 — Client Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Equip the AI agent and SvelteKit web dashboard with structured long-term memory for clients, enabling it to remember technical parameters (e.g., tracking software, Cubism versions), rigging/separation scope preferences, and project facts while strictly distinguishing verified facts from speculative inferences.

**Architecture:** Database schema and query layer in `packages/db` for `client_memories` with cascading deletion. Memory classification, validation, and grouping domain service in `packages/domain`. Injected prompt formatting in `packages/agent` separating facts, preferences, and inferences with strict guardrails. REST endpoints (`/api/v1/clients/:id/memories`) in `apps/api`. UI management interface in `apps/web` on the `/clients/[id]` page adhering to `DESIGN.md`.

**Tech Stack:** Bun, Drizzle ORM + PostgreSQL (`packages/db`), TypeScript (`packages/domain`), Elysia (`apps/api`), SvelteKit 3 + Svelte 5 runes + Tailwind v4 + Lucide (`apps/web`), Bun test.

**Spec:** `docs/phase/phase-8-client-memory.md`, `docs/DESIGN.md`, `docs/DATA_MODEL.md`, `docs/API.md`.

---

## Global Constraints

- **Epistemic Certainty Separation:** The memory taxonomy defines three distinct tiers:
  - `FACT`: Explicitly confirmed information (e.g., tracking software, PSD drive link, character specs).
  - `PREFERENCE`: Workflow & scope habits (e.g., milestone review order, naming convention, motion style).
  - `INFERENCE`: Speculative hypothesis (e.g., unconfirmed debut dates).
  *The agent MUST NEVER present an `INFERENCE` as a known `FACT`.*
- **Domain Categories:** Structured categories tailored for rigging and separation: `technical`, `scope`, `assets`, `general`, `communication`.
- **Design System Fidelity (`DESIGN.md`):** Background `#ddf4ff` (canvas); Cards `#ffffff` with `#c7e8fa` border; Rounded corners `12px` (`rounded-xl`); Primary action `#a5ed6e`; Secondary accent `#1cb0f6`; Text `#3c3c3c` bold.
- **No Database Logic in Web:** SvelteKit frontend MUST NEVER import `@client-agent/db`. All memory mutations and queries operate through the typed `ApiClient` talking to Elysia REST endpoints (`/api/v1/*`).
- **Svelte 5 Runes:** Use modern runes (`$state`, `$derived`, `$effect`, `$props`) and snippets. Never use legacy Svelte 4 store patterns.

---

## Review Focus

1. **Inference Presented as Fact in Agent Prompt:** If an inference exists for a client, the prompt builder must isolate it under a distinct `[AI INFERENCES - NOT VERIFIED FACTS]` header and instruct the LLM never to assert it as fact. Test: verify prompt output string segregation and system rules.
2. **Client Deletion Cascading:** Deleting a client from the database must automatically delete all linked `client_memories` via database foreign key `onDelete: 'cascade'` without leaving orphan memory rows. Test: delete a client and verify associated memories are removed.
3. **Empty or Whitespace-only Memory Content:** Creating or updating a memory with empty or whitespace-only strings must return HTTP 400 Bad Request or throw validation error. Test: test both API and domain service rejections.
4. **Cross-Client Memory Boundary Validation:** Attempting to update or delete a memory ID that belongs to Client B using a URL path for Client A (`/api/v1/clients/1/memories/999` where memory 999 belongs to client 2) must return HTTP 404 and make no changes. Test: assert 404 and assert database record is unmutated.
5. **Live SvelteKit Reactivity on Add/Edit/Delete:** In the web UI, adding, editing, or deleting a memory item must update local UI state reactively without requiring a browser page reload. Test: unit test the `ApiClient` methods and state updater flows.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/schema/client_memories.ts` | Drizzle schema definition for `client_memories` table |
| `packages/db/src/schema/index.ts` (modify) | Re-export `client_memories` schema and types |
| `packages/db/src/queries/client_memories.ts` | Queries: insert, get by id, list by client, update, delete |
| `packages/db/src/queries/index.ts` (modify) | Re-export client memory queries |
| `packages/db/tests/client-memories.test.ts` | Unit tests for DB schema, CRUD, cascade delete |
| `packages/domain/src/enums.ts` (modify) | Add `MemoryType`, `MemoryCategory`, `MemorySource`, `MemoryConfidence` |
| `packages/domain/src/entities.ts` (modify) | Add `ClientMemory` interface |
| `packages/domain/src/services/memoryService.ts` | Memory service (validation, grouping, repository contract) |
| `packages/domain/src/index.ts` (modify) | Re-export memory domain service, types, and enums |
| `packages/domain/tests/memoryService.test.ts` | Unit tests for memory validation and grouping logic |
| `packages/agent/src/prompts/builder.ts` (modify) | Context builder formatting with memory blocks (`FACT`, `PREFERENCE`, `INFERENCE`) |
| `packages/agent/tests/memory-prompts.test.ts` | Unit tests verifying memory segregation in agent prompts |
| `apps/worker/src/handlers/generateReplyDraft.ts` (modify) | Fetch client memories and feed them into reply context |
| `apps/worker/src/handlers/generateSummary.ts` (modify) | Fetch client memories and feed them into summary context |
| `apps/worker/tests/reply-draft-memory.test.ts` | Unit tests verifying worker injects memories into agent run inputs |
| `apps/api/src/routes/clients.ts` (modify) | REST endpoints `GET /:id/memories`, `POST /:id/memories`, `PATCH /:id/memories/:memoryId`, `DELETE /:id/memories/:memoryId` |
| `apps/api/tests/client-memories-api.test.ts` | Integration tests for memory REST API endpoints |
| `apps/web/src/lib/api.ts` (modify) | Frontend client methods for listing, adding, editing, deleting memories |
| `apps/web/tests/api-client-memories.test.ts` | Unit tests verifying `ApiClient` memory methods |
| `apps/web/src/routes/clients/[id]/+page.svelte` (modify) | Real memory cards, category pills, add/edit modal, and delete actions |
| `tests/e2e-client-memory.test.ts` | Complete Phase 8 end-to-end integration test suite |

---

## Tasks

### Task 1: Database Schema & Queries for Client Memory (`packages/db`)

**Files:**
- Create: `packages/db/src/schema/client_memories.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/queries/client_memories.ts`
- Modify: `packages/db/src/queries/index.ts`
- Test: `packages/db/tests/client-memories.test.ts`

**Interfaces:**
- Produces:
  - Table: `client_memories`
  - Types: `ClientMemoryRow`, `NewClientMemoryRow`
  - Queries:
    - `insertClientMemory(input: InsertClientMemoryInput): Promise<ClientMemoryRow>`
    - `getClientMemoryById(id: number): Promise<ClientMemoryRow | null>`
    - `listClientMemories(clientId: number, type?: string): Promise<ClientMemoryRow[]>`
    - `updateClientMemory(id: number, content: string): Promise<ClientMemoryRow | null>`
    - `deleteClientMemory(id: number): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Create `packages/db/tests/client-memories.test.ts`:
```typescript
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import {
  db,
  getOwnerUserId,
  insertClient,
  insertClientMemory,
  getClientMemoryById,
  listClientMemories,
  updateClientMemory,
  deleteClientMemory,
  clients,
  clientMemories,
} from '../src';
import { eq } from 'drizzle-orm';

describe('Client Memories Database Queries', () => {
  const suffix = Date.now();
  let ownerUserId: number;
  let testClientId: number;

  beforeAll(async () => {
    ownerUserId = await getOwnerUserId();
    const client = await insertClient({
      userId: ownerUserId,
      platform: 'vgen',
      username: `mem_user_${suffix}`,
      displayName: `Memory Test User ${suffix}`,
    });
    testClientId = client.id;
  });

  afterAll(async () => {
    await db.delete(clients).where(eq(clients.id, testClientId));
  });

  it('inserts and retrieves a client memory', async () => {
    const memory = await insertClientMemory({
      clientId: testClientId,
      type: 'fact',
      category: 'technical',
      content: 'Uses VTube Studio on iOS tracking',
      source: 'user_note',
      confidence: 'high',
    });

    expect(memory.id).toBeDefined();
    expect(memory.clientId).toBe(testClientId);
    expect(memory.type).toBe('fact');
    expect(memory.category).toBe('technical');
    expect(memory.content).toBe('Uses VTube Studio on iOS tracking');

    const fetched = await getClientMemoryById(memory.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.content).toBe(memory.content);
  });

  it('lists memories filtered by client ID and type', async () => {
    await insertClientMemory({
      clientId: testClientId,
      type: 'preference',
      category: 'scope',
      content: 'Prefers milestone review for head before physics',
    });

    const all = await listClientMemories(testClientId);
    expect(all.length).toBeGreaterThanOrEqual(2);

    const preferencesOnly = await listClientMemories(testClientId, 'preference');
    expect(preferencesOnly.every((m) => m.type === 'preference')).toBe(true);
  });

  it('updates memory content and updates timestamp', async () => {
    const memory = await insertClientMemory({
      clientId: testClientId,
      type: 'fact',
      category: 'assets',
      content: 'PSD link: v1',
    });

    const updated = await updateClientMemory(memory.id, 'PSD link: v2 final');
    expect(updated?.content).toBe('PSD link: v2 final');
  });

  it('deletes a memory by id', async () => {
    const memory = await insertClientMemory({
      clientId: testClientId,
      type: 'inference',
      category: 'general',
      content: 'May need commercial rights',
    });

    const success = await deleteClientMemory(memory.id);
    expect(success).toBe(true);

    const check = await getClientMemoryById(memory.id);
    expect(check).toBeNull();
  });

  it('cascades delete when parent client is removed', async () => {
    const tempClient = await insertClient({
      userId: ownerUserId,
      platform: 'vgen',
      username: `cascade_user_${suffix}`,
    });
    const mem = await insertClientMemory({
      clientId: tempClient.id,
      type: 'fact',
      category: 'general',
      content: 'Will be deleted with client',
    });

    await db.delete(clients).where(eq(clients.id, tempClient.id));
    const check = await getClientMemoryById(mem.id);
    expect(check).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/db/tests/client-memories.test.ts`
Expected: FAIL due to missing `client_memories` schema and query exports.

- [ ] **Step 3: Implement `client_memories` schema and queries in `packages/db`**

1. Create `packages/db/src/schema/client_memories.ts`:
   - `id`: `bigserial('id', { mode: 'number' }).primaryKey()`
   - `clientId`: `bigint('client_id', { mode: 'number' }).notNull().references(() => clients.id, { onDelete: 'cascade' })`
   - `type`: `varchar('type', { length: 32 }).notNull()`
   - `category`: `varchar('category', { length: 64 }).notNull()`
   - `content`: `text('content').notNull()`
   - `source`: `varchar('source', { length: 64 }).notNull().default('user_note')`
   - `confidence`: `varchar('confidence', { length: 32 }).notNull().default('high')`
   - `createdAt`: `timestamp('created_at', { withTimezone: true }).defaultNow().notNull()`
   - `updatedAt`: `timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()`
2. Export from `packages/db/src/schema/index.ts`.
3. Create `packages/db/src/queries/client_memories.ts` with:
   - `insertClientMemory`, `getClientMemoryById`, `listClientMemories`, `updateClientMemory`, `deleteClientMemory`.
4. Export from `packages/db/src/queries/index.ts`.
5. Run Drizzle migration:
   `bun run --filter=@client-agent/db db:generate && bun run --filter=@client-agent/db db:migrate`

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/db/tests/client-memories.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): add client_memories table schema, queries, and migration"
```

---

### Task 2: Domain Types & Memory Service (`packages/domain`)

**Files:**
- Modify: `packages/domain/src/enums.ts`
- Modify: `packages/domain/src/entities.ts`
- Create: `packages/domain/src/services/memoryService.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/memoryService.test.ts`

**Interfaces:**
- Consumes: `MemoryType`, `MemoryCategory`, `MemorySource`, `MemoryConfidence`
- Produces:
  - `ClientMemory` interface
  - `MemoryRepository` interface
  - `addMemory(repo: MemoryRepository, input: AddMemoryInput): Promise<ClientMemory>`
  - `getClientMemories(repo: MemoryRepository, clientId: number): Promise<GroupedClientMemories>`
  - `updateMemory(repo: MemoryRepository, memoryId: number, content: string): Promise<ClientMemory>`
  - `deleteMemory(repo: MemoryRepository, memoryId: number): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Create `packages/domain/tests/memoryService.test.ts`:
```typescript
import { describe, expect, it } from 'bun:test';
import {
  MemoryType,
  MemoryCategory,
  MemorySource,
  MemoryConfidence,
  addMemory,
  getClientMemories,
  updateMemory,
  deleteMemory,
  type MemoryRepository,
  type ClientMemory,
} from '../src';

describe('Client Memory Domain Service', () => {
  const store = new Map<number, ClientMemory>();
  let nextId = 1;

  const mockRepo: MemoryRepository = {
    async insertMemory(data) {
      const item: ClientMemory = {
        id: nextId++,
        clientId: data.clientId,
        type: data.type,
        category: data.category,
        content: data.content,
        source: data.source ?? MemorySource.USER_NOTE,
        confidence: data.confidence ?? MemoryConfidence.HIGH,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(item.id, item);
      return item;
    },
    async getMemoryById(id) {
      return store.get(id) ?? null;
    },
    async listMemoriesByClientId(clientId, type) {
      return Array.from(store.values()).filter(
        (m) => m.clientId === clientId && (!type || m.type === type)
      );
    },
    async updateMemory(id, content) {
      const item = store.get(id);
      if (!item) return null;
      item.content = content;
      item.updatedAt = new Date();
      return item;
    },
    async deleteMemory(id) {
      return store.delete(id);
    },
  };

  it('validates and inserts memory rejecting empty content', async () => {
    await expect(
      addMemory(mockRepo, {
        clientId: 1,
        type: MemoryType.FACT,
        category: MemoryCategory.TECHNICAL,
        content: '   ',
      })
    ).rejects.toThrow('Memory content cannot be empty');

    const created = await addMemory(mockRepo, {
      clientId: 1,
      type: MemoryType.FACT,
      category: MemoryCategory.TECHNICAL,
      content: 'Uses VTube Studio',
    });
    expect(created.id).toBeDefined();
    expect(created.content).toBe('Uses VTube Studio');
  });

  it('groups memories into facts, preferences, and inferences', async () => {
    await addMemory(mockRepo, {
      clientId: 1,
      type: MemoryType.PREFERENCE,
      category: MemoryCategory.SCOPE,
      content: 'Wants rough sketch approval first',
    });

    await addMemory(mockRepo, {
      clientId: 1,
      type: MemoryType.INFERENCE,
      category: MemoryCategory.GENERAL,
      content: 'Might be planning a holiday stream',
    });

    const grouped = await getClientMemories(mockRepo, 1);
    expect(grouped.facts.length).toBe(1);
    expect(grouped.preferences.length).toBe(1);
    expect(grouped.inferences.length).toBe(1);
    expect(grouped.facts[0].type).toBe(MemoryType.FACT);
  });

  it('updates memory content rejecting empty update', async () => {
    const list = await mockRepo.listMemoriesByClientId(1);
    const target = list[0];

    await expect(updateMemory(mockRepo, target.id, '')).rejects.toThrow(
      'Memory content cannot be empty'
    );

    const updated = await updateMemory(mockRepo, target.id, 'Updated note content');
    expect(updated.content).toBe('Updated note content');
  });

  it('deletes memory and confirms removal', async () => {
    const list = await mockRepo.listMemoriesByClientId(1);
    const target = list[0];

    const deleted = await deleteMemory(mockRepo, target.id);
    expect(deleted).toBe(true);

    const check = await mockRepo.getMemoryById(target.id);
    expect(check).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/domain/tests/memoryService.test.ts`
Expected: FAIL due to missing enums, entities, and `memoryService.ts`.

- [ ] **Step 3: Implement domain enums, entities, and service in `packages/domain`**

1. In `packages/domain/src/enums.ts`, add:
   ```typescript
   export enum MemoryType {
     FACT = 'fact',
     PREFERENCE = 'preference',
     INFERENCE = 'inference',
   }
   export enum MemoryCategory {
     TECHNICAL = 'technical',
     SCOPE = 'scope',
     ASSETS = 'assets',
     GENERAL = 'general',
     COMMUNICATION = 'communication',
   }
   export enum MemorySource {
     USER_NOTE = 'user_note',
     CONVERSATION_EXTRACTION = 'conversation_extraction',
     AGENT_INFERENCE = 'agent_inference',
   }
   export enum MemoryConfidence {
     HIGH = 'high',
     MEDIUM = 'medium',
     LOW = 'low',
   }
   ```
2. In `packages/domain/src/entities.ts`, add `ClientMemory` interface.
3. In `packages/domain/src/services/memoryService.ts`, implement `addMemory`, `getClientMemories`, `updateMemory`, `deleteMemory` with validation.
4. Export from `packages/domain/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/domain/tests/memoryService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): add client memory enums, entities, and memoryService"
```

---

### Task 3: Context Builder Memory Injection in Agent (`packages/agent`)

**Files:**
- Modify: `packages/agent/src/prompts/builder.ts`
- Test: `packages/agent/tests/memory-prompts.test.ts`

**Interfaces:**
- Consumes: `ConversationContextForPrompt`, `ClientMemoryItemForPrompt`
- Produces: Updated `buildReplyPrompt` and `buildSummaryPrompt` rendering categorized memory blocks with strict isolation between `FACT` and `INFERENCE`.

- [ ] **Step 1: Write the failing test**

Create `packages/agent/tests/memory-prompts.test.ts`:
```typescript
import { describe, expect, it } from 'bun:test';
import {
  buildReplyPrompt,
  buildSummaryPrompt,
  type ConversationContextForPrompt,
  type ClientMemoryItemForPrompt,
} from '../src/prompts/builder';

describe('Agent Context Builder Memory Injection', () => {
  const sampleMemories: ClientMemoryItemForPrompt[] = [
    {
      type: 'fact',
      category: 'technical',
      content: 'Uses VTube Studio on iOS tracking',
    },
    {
      type: 'preference',
      category: 'scope',
      content: 'Prefers milestone review for head XYZ before body physics',
    },
    {
      type: 'inference',
      category: 'general',
      content: 'May be planning a debut next month',
    },
  ];

  const baseContext: ConversationContextForPrompt = {
    clientUsername: 'ErianOsamu',
    clientDisplayName: 'Erian',
    creatorUsername: 'r1daz_',
    messages: [
      {
        direction: 'inbound',
        senderName: 'Erian',
        content: 'Hi! Could you check my model file?',
        sentAt: new Date(),
      },
    ],
    memories: sampleMemories,
  };

  it('injects formatted memory block into reply prompt with strict inference caveat', () => {
    const prompt = buildReplyPrompt(baseContext, 'Confirm we will review the head first');
    const userMessage = prompt.find((m) => m.role === 'user')?.content ?? '';
    const systemMessage = prompt.find((m) => m.role === 'system')?.content ?? '';

    expect(userMessage).toContain('CLIENT BACKGROUND & MEMORY:');
    expect(userMessage).toContain('[VERIFIED FACTS]');
    expect(userMessage).toContain('Uses VTube Studio on iOS tracking');

    expect(userMessage).toContain('[KNOWN PREFERENCES]');
    expect(userMessage).toContain('Prefers milestone review for head XYZ before body physics');

    expect(userMessage).toContain('[AI INFERENCES - NOT VERIFIED FACTS]');
    expect(userMessage).toContain('May be planning a debut next month');
    expect(userMessage).toContain('Never assume as established fact');

    expect(systemMessage).toContain('Use verified facts and known preferences to personalize your draft');
    expect(systemMessage).toContain('NEVER state an unverified inference as a confirmed fact');
  });

  it('renders gracefully when memories are empty', () => {
    const prompt = buildReplyPrompt({ ...baseContext, memories: [] }, 'Test reply');
    const userMessage = prompt.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).not.toContain('[VERIFIED FACTS]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/agent/tests/memory-prompts.test.ts`
Expected: FAIL due to missing `memories` in `ConversationContextForPrompt` and missing memory block formatting.

- [ ] **Step 3: Update `packages/agent/src/prompts/builder.ts`**

1. Define `ClientMemoryItemForPrompt`:
   ```typescript
   export interface ClientMemoryItemForPrompt {
     type: 'fact' | 'preference' | 'inference' | string;
     category: string;
     content: string;
   }
   ```
2. Extend `ConversationContextForPrompt`:
   ```typescript
   export interface ConversationContextForPrompt {
     clientUsername: string;
     clientDisplayName?: string;
     creatorUsername?: string;
     messages: PromptMessageHistory[];
     memories?: ClientMemoryItemForPrompt[];
   }
   ```
3. Add helper `formatClientMemories(memories?: ClientMemoryItemForPrompt[]): string`:
   Formats facts under `[VERIFIED FACTS]`, preferences under `[KNOWN PREFERENCES]`, and inferences under `[AI INFERENCES - NOT VERIFIED FACTS] (Verify before assuming! Never assume as established fact)`.
4. Include memory block in `buildReplyPrompt` and `buildSummaryPrompt`.
5. Update `SYSTEM_ANTI_SLOP_RULES` and drafting constraints to strictly enforce:
   `"MEMORY FIDELITY: Use verified facts and known preferences to personalize your draft. If referencing an inference, phrase it gently as a question, and NEVER state an unverified inference as a confirmed fact."`

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/agent/tests/memory-prompts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent
git commit -m "feat(agent): inject structured client memory into reply and summary prompts"
```

---

### Task 4: Worker Integration for Agent Prompts (`apps/worker`)

**Files:**
- Modify: `apps/worker/src/handlers/generateReplyDraft.ts`
- Modify: `apps/worker/src/handlers/generateSummary.ts`
- Test: `apps/worker/tests/reply-draft-memory.test.ts`

**Interfaces:**
- Consumes: `listClientMemories` from `@client-agent/db`, `ConversationContextForPrompt` from `@client-agent/agent`
- Produces: Prompt context injected with actual database client memories.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/tests/reply-draft-memory.test.ts`:
```typescript
import { describe, expect, it, mock } from 'bun:test';
import { handleGenerateReplyDraft } from '../src/handlers/generateReplyDraft';
import {
  db,
  getOwnerUserId,
  insertClient,
  insertClientMemory,
  insertConversation,
  insertTask,
  getTaskById,
  tasks,
  clients,
  conversations,
} from '@client-agent/db';
import { TaskStatus, TaskType } from '@client-agent/domain';
import { eq } from 'drizzle-orm';

describe('Worker Reply Draft with Client Memory', () => {
  const suffix = Date.now();
  let ownerId: number;
  let client: any;
  let conv: any;

  it('loads client memories and includes them in AI chat completion prompt', async () => {
    ownerId = await getOwnerUserId();
    client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `mem_worker_${suffix}`,
    });
    conv = await insertConversation({
      userId: ownerId,
      clientId: client.id,
      platform: 'vgen',
      externalThreadId: `thread_${suffix}`,
    });

    await insertClientMemory({
      clientId: client.id,
      type: 'fact',
      category: 'technical',
      content: 'Uses VTube Studio iOS tracking',
    });

    const taskRow = await insertTask({
      userId: ownerId,
      type: TaskType.GENERATE_REPLY_DRAFT,
      input: {
        clientUsername: client.username,
        instruction: 'Confirm file receipt',
      },
      status: TaskStatus.QUEUED,
    });

    let sentMessages: any[] = [];
    const mockAiClient = {
      async createChatCompletion(params: any) {
        sentMessages = params.messages;
        return {
          content: 'Confirmed, got your files! Setting up for VTube Studio iOS tracking.',
          model: 'gpt-4o',
          finishReason: 'stop',
          durationMs: 120,
          usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        };
      },
    };

    await handleGenerateReplyDraft(
      { id: '1', data: { taskId: String(taskRow.id) } },
      { aiClient: mockAiClient as any }
    );

    const updatedTask = await getTaskById(taskRow.id);
    expect(updatedTask?.status).toBe(TaskStatus.COMPLETED);

    const userPrompt = sentMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(userPrompt).toContain('Uses VTube Studio iOS tracking');

    // Clean up
    await db.delete(clients).where(eq(clients.id, client.id));
    await db.delete(tasks).where(eq(tasks.id, taskRow.id));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/worker/tests/reply-draft-memory.test.ts`
Expected: FAIL because `handleGenerateReplyDraft` does not yet query or pass `memories`.

- [ ] **Step 3: Modify `generateReplyDraft.ts` and `generateSummary.ts` in `apps/worker`**

1. In `apps/worker/src/handlers/generateReplyDraft.ts`:
   - Import `listClientMemories` from `@client-agent/db`.
   - After fetching `client`, if `client` exists:
     ```typescript
     const memoryRows = await listClientMemories(client.id);
     const memories = memoryRows.map((m) => ({
       type: m.type,
       category: m.category,
       content: m.content,
     }));
     ```
   - Attach `memories` to `context`.
2. In `apps/worker/src/handlers/generateSummary.ts`:
   - Fetch and attach `memories` in the same way.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/worker/tests/reply-draft-memory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): feed persistent client memories into AI reply and summary handlers"
```

---

### Task 5: REST API Endpoints for Client Memories (`apps/api`)

**Files:**
- Modify: `apps/api/src/routes/clients.ts`
- Test: `apps/api/tests/client-memories-api.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/v1/clients/:id/memories` — returns `{ memories: ClientMemoryRow[], grouped: { facts: ..., preferences: ..., inferences: ... } }`
  - `POST /api/v1/clients/:id/memories` — body: `{ type, category, content, source?, confidence? }`, returns `{ memory: ClientMemoryRow }`
  - `PATCH /api/v1/clients/:id/memories/:memoryId` — body: `{ content }`, returns `{ memory: ClientMemoryRow }`
  - `DELETE /api/v1/clients/:id/memories/:memoryId` — returns `{ success: true }`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/client-memories-api.test.ts`:
```typescript
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import {
  db,
  getOwnerUserId,
  insertClient,
  clients,
  clientMemories,
} from '@client-agent/db';
import { app } from '../src/app';
import { createSession } from '../src/auth/session';
import { eq } from 'drizzle-orm';

describe('Client Memories REST API Endpoints', () => {
  let cookieHeader: string;
  let ownerId: number;
  let testClientId: number;
  let otherClientId: number;
  const suffix = Date.now();

  beforeAll(async () => {
    ownerId = await getOwnerUserId();
    const sessionId = await createSession(ownerId);
    cookieHeader = `session=${sessionId}`;

    const clientA = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `mem_api_client_${suffix}`,
    });
    testClientId = clientA.id;

    const clientB = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `other_api_client_${suffix}`,
    });
    otherClientId = clientB.id;
  });

  afterAll(async () => {
    await db.delete(clients).where(eq(clients.id, testClientId));
    await db.delete(clients).where(eq(clients.id, otherClientId));
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories`)
    );
    expect(res.status).toBe(401);
  });

  it('creates a new memory record for a client via POST', async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories`, {
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'fact',
          category: 'technical',
          content: 'Model created in Live2D Cubism 5.0',
        }),
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memory.id).toBeDefined();
    expect(body.memory.content).toBe('Model created in Live2D Cubism 5.0');
  });

  it('rejects POST with empty content with 400 Bad Request', async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories`, {
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'fact',
          category: 'technical',
          content: '   ',
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('lists client memories with grouped categories via GET', async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories`, {
        headers: { Cookie: cookieHeader },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories).toBeInstanceOf(Array);
    expect(body.grouped).toBeDefined();
    expect(body.grouped.facts).toBeInstanceOf(Array);
  });

  it('updates a memory record via PATCH', async () => {
    // First create a memory to patch
    const createRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories`, {
        method: 'POST',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'preference',
          category: 'scope',
          content: 'Initial preference text',
        }),
      })
    );
    const { memory } = await createRes.json();

    const patchRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories/${memory.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Updated preference text' }),
      })
    );

    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.memory.content).toBe('Updated preference text');
  });

  it('prevents modifying memory belonging to a different client (cross-client boundary)', async () => {
    // Create memory on client B
    const createRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${otherClientId}/memories`, {
        method: 'POST',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'fact',
          category: 'general',
          content: 'Belongs to Client B',
        }),
      })
    );
    const { memory } = await createRes.json();

    // Try to update it through Client A's URL path
    const patchRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories/${memory.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hacked content' }),
      })
    );
    expect(patchRes.status).toBe(404);
  });

  it('deletes a memory record via DELETE', async () => {
    const createRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories`, {
        method: 'POST',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'inference',
          category: 'general',
          content: 'To be deleted',
        }),
      })
    );
    const { memory } = await createRes.json();

    const deleteRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${testClientId}/memories/${memory.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader },
      })
    );
    expect(deleteRes.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/tests/client-memories-api.test.ts`
Expected: FAIL with 404 route not found.

- [ ] **Step 3: Implement client memory endpoints in `apps/api/src/routes/clients.ts`**

1. Import `insertClientMemory`, `getClientMemoryById`, `listClientMemories`, `updateClientMemory`, `deleteClientMemory` from `@client-agent/db`.
2. Add routes to `createClientRoutes()`:
   - `GET /:id/memories`: Verify client exists, fetch memories, group into `facts`, `preferences`, and `inferences`, return `{ memories, grouped }`.
   - `POST /:id/memories`: Validate `content.trim().length > 0`, `type` in `('fact', 'preference', 'inference')`, insert memory, return HTTP 201 with `{ memory }`.
   - `PATCH /:id/memories/:memoryId`: Verify memory exists AND belongs to `clientId`. Validate content. Update and return `{ memory }`.
   - `DELETE /:id/memories/:memoryId`: Verify memory exists AND belongs to `clientId`. Delete and return `{ success: true }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/tests/client-memories-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add REST endpoints for client memories CRUD and grouping"
```

---

### Task 6: Frontend API Client & Client Details Memory UI (`apps/web`)

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/web/tests/api-client-memories.test.ts`
- Modify: `apps/web/src/routes/clients/[id]/+page.svelte`

**Interfaces:**
- Produces:
  - `ApiClient` methods:
    - `listClientMemories(clientId: number): Promise<{ memories: ClientMemoryItem[]; grouped: GroupedClientMemories }>`
    - `createClientMemory(clientId: number, input: CreateMemoryInput): Promise<ClientMemoryItem>`
    - `updateClientMemory(clientId: number, memoryId: number, content: string): Promise<ClientMemoryItem>`
    - `deleteClientMemory(clientId: number, memoryId: number): Promise<{ success: boolean }>`
  - UI in `apps/web/src/routes/clients/[id]/+page.svelte`:
    - Shows real client memories grouped by `FACT`, `PREFERENCE`, and `INFERENCE`.
    - Category pills (`technical`, `scope`, `assets`, `general`, `communication`).
    - "Add Memory / Note" button opening interactive modal dialog.
    - Inline delete and edit buttons per item with reactive state update.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/api-client-memories.test.ts`:
```typescript
import { describe, expect, it, mock } from 'bun:test';
import { ApiClient } from '../src/lib/api';

describe('ApiClient Client Memories Methods', () => {
  it('calls GET /api/v1/clients/:id/memories', async () => {
    let requestedUrl = '';
    const mockFetch = mock(async (url: string, init?: any) => {
      requestedUrl = url;
      return new Response(
        JSON.stringify({
          memories: [{ id: 1, clientId: 42, type: 'fact', content: 'Test memory' }],
          grouped: { facts: [{ id: 1, text: 'Test memory' }], preferences: [], inferences: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new ApiClient('http://localhost:3001', mockFetch as any);
    const res = await client.listClientMemories(42);

    expect(requestedUrl).toBe('http://localhost:3001/api/v1/clients/42/memories');
    expect(res.memories.length).toBe(1);
    expect(res.grouped.facts.length).toBe(1);
  });

  it('calls POST /api/v1/clients/:id/memories', async () => {
    let sentMethod = '';
    let sentBody = '';
    const mockFetch = mock(async (url: string, init?: any) => {
      sentMethod = init?.method;
      sentBody = init?.body;
      return new Response(
        JSON.stringify({
          memory: { id: 2, clientId: 42, type: 'fact', category: 'technical', content: 'VTube Studio' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new ApiClient('http://localhost:3001', mockFetch as any);
    const res = await client.createClientMemory(42, {
      type: 'fact',
      category: 'technical',
      content: 'VTube Studio',
    });

    expect(sentMethod).toBe('POST');
    expect(JSON.parse(sentBody).category).toBe('technical');
    expect(res.id).toBe(2);
  });

  it('calls PATCH and DELETE for memory item', async () => {
    const mockFetch = mock(async (url: string, init?: any) => {
      if (init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({ memory: { id: 2, content: 'Updated' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new ApiClient('http://localhost:3001', mockFetch as any);
    const patched = await client.updateClientMemory(42, 2, 'Updated');
    expect(patched.content).toBe('Updated');

    const deleted = await client.deleteClientMemory(42, 2);
    expect(deleted.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/web/tests/api-client-memories.test.ts`
Expected: FAIL due to missing memory methods on `ApiClient`.

- [ ] **Step 3: Implement client memory methods in `apps/web/src/lib/api.ts`**

1. Define interfaces:
   ```typescript
   export interface ClientMemoryItem {
     id: number;
     clientId: number;
     type: 'fact' | 'preference' | 'inference';
     category: 'technical' | 'scope' | 'assets' | 'general' | 'communication';
     content: string;
     source: string;
     confidence: string;
     createdAt: string | Date;
     updatedAt: string | Date;
   }

   export interface GroupedClientMemories {
     facts: ClientMemoryItem[];
     preferences: ClientMemoryItem[];
     inferences: ClientMemoryItem[];
   }

   export interface CreateClientMemoryInput {
     type: 'fact' | 'preference' | 'inference';
     category: 'technical' | 'scope' | 'assets' | 'general' | 'communication';
     content: string;
     source?: string;
     confidence?: string;
   }
   ```
2. Add methods to `ApiClient`:
   - `listClientMemories(clientId: number)`
   - `createClientMemory(clientId: number, input: CreateClientMemoryInput)`
   - `updateClientMemory(clientId: number, memoryId: number, content: string)`
   - `deleteClientMemory(clientId: number, memoryId: number)`

- [ ] **Step 4: Update `apps/web/src/routes/clients/[id]/+page.svelte`**

1. Add state:
   - `memories = $state<ClientMemoryItem[]>([])`
   - `isMemoryModalOpen = $state(false)`
   - `editingMemory = $state<ClientMemoryItem | null>(null)`
   - Form inputs: `newType`, `newCategory`, `newContent`, `isSubmittingMemory`
2. Fetch memories on page mount via `api.listClientMemories(clientId)`.
3. Compute derived grouped memories:
   - `facts = $derived(memories.filter(m => m.type === 'fact'))`
   - `preferences = $derived(memories.filter(m => m.type === 'preference'))`
   - `inferences = $derived(memories.filter(m => m.type === 'inference'))`
4. Add "Add Fact / Scope Note" button with Lucide icon (`Plus` / `Sparkles`).
5. Render category badge on each card (`technical`, `scope`, `assets`, `general`).
6. Add edit and delete action buttons with confirmation.
7. Style modal matching `DESIGN.md` tokens (`#ddf4ff`, `#c7e8fa`, `#a5ed6e`, `rounded-xl`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test apps/web/tests/api-client-memories.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): integrate client memory management UI and ApiClient methods"
```

---

### Task 7: End-to-End Integration Test & Phase 8 Verification

**Files:**
- Create: `tests/e2e-client-memory.test.ts`
- Modify: `docs/PHASES.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Validates the complete flow from database, REST API, worker prompt injection, and memory deletion.

- [ ] **Step 1: Write the end-to-end integration test**

Create `tests/e2e-client-memory.test.ts`:
```typescript
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import {
  db,
  getOwnerUserId,
  insertClient,
  getClientById,
  clients,
  clientMemories,
} from '@client-agent/db';
import { app } from '../apps/api/src/app';
import { createSession } from '../apps/api/src/auth/session';
import { eq } from 'drizzle-orm';
import { buildReplyPrompt } from '@client-agent/agent/prompts/builder';

describe('Phase 8 — Client Memory End-to-End Integration Suite', () => {
  let cookieHeader: string;
  let ownerId: number;
  let clientId: number;
  const suffix = Date.now();

  beforeAll(async () => {
    ownerId = await getOwnerUserId();
    const sessionId = await createSession(ownerId);
    cookieHeader = `session=${sessionId}`;

    const client = await insertClient({
      userId: ownerId,
      platform: 'vgen',
      username: `e2e_client_mem_${suffix}`,
      displayName: `E2E Memory Client ${suffix}`,
    });
    clientId = client.id;
  });

  afterAll(async () => {
    await db.delete(clients).where(eq(clients.id, clientId));
  });

  it('1. Adds verified technical facts and rigging scope preferences via REST API', async () => {
    // Add technical fact
    const factRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        method: 'POST',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'fact',
          category: 'technical',
          content: 'Model rig target: VTube Studio iOS tracking, Cubism 5.0',
        }),
      })
    );
    expect(factRes.status).toBe(201);

    // Add scope preference
    const prefRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        method: 'POST',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'preference',
          category: 'scope',
          content: 'Prefers separate approval for eye physics and mouth tracking',
        }),
      })
    );
    expect(prefRes.status).toBe(201);

    // Add inference
    const infRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        method: 'POST',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'inference',
          category: 'general',
          content: 'Might debut within 3 weeks',
        }),
      })
    );
    expect(infRes.status).toBe(201);
  });

  it('2. Retrieves memories grouped by type through API', async () => {
    const listRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        headers: { Cookie: cookieHeader },
      })
    );
    expect(listRes.status).toBe(200);
    const body = await listRes.json();
    expect(body.grouped.facts.length).toBe(1);
    expect(body.grouped.preferences.length).toBe(1);
    expect(body.grouped.inferences.length).toBe(1);
  });

  it('3. Injects memories into Agent Prompt with strict epistemic segregation', async () => {
    const listRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        headers: { Cookie: cookieHeader },
      })
    );
    const { memories } = await listRes.json();

    const promptMessages = buildReplyPrompt(
      {
        clientUsername: `e2e_client_mem_${suffix}`,
        messages: [
          {
            direction: 'inbound',
            senderName: 'Client',
            content: 'How is the tracking setup coming along?',
            sentAt: new Date(),
          },
        ],
        memories,
      },
      'Tell them progress is smooth'
    );

    const userPrompt = promptMessages.find((m) => m.role === 'user')?.content ?? '';
    const systemPrompt = promptMessages.find((m) => m.role === 'system')?.content ?? '';

    // Verify fact is under [VERIFIED FACTS]
    expect(userPrompt).toContain('[VERIFIED FACTS]');
    expect(userPrompt).toContain('VTube Studio iOS tracking');

    // Verify preference is under [KNOWN PREFERENCES]
    expect(userPrompt).toContain('[KNOWN PREFERENCES]');
    expect(userPrompt).toContain('eye physics and mouth tracking');

    // Verify inference has warning header and is never presented as fact
    expect(userPrompt).toContain('[AI INFERENCES - NOT VERIFIED FACTS]');
    expect(userPrompt).toContain('Never assume as established fact');
    expect(systemPrompt).toContain('NEVER state an unverified inference as a confirmed fact');
  });

  it('4. Updates memory content via API and verifies persistence', async () => {
    const listRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        headers: { Cookie: cookieHeader },
      })
    );
    const { memories } = await listRes.json();
    const target = memories[0];

    const patchRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories/${target.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Updated rig target: Cubism 5.0 with VBridger parameters' }),
      })
    );
    expect(patchRes.status).toBe(200);

    const verifyRes = await app.handle(
      new Request(`http://localhost/api/v1/clients/${clientId}/memories`, {
        headers: { Cookie: cookieHeader },
      })
    );
    const verifyBody = await verifyRes.json();
    const updated = verifyBody.memories.find((m: any) => m.id === target.id);
    expect(updated.content).toContain('VBridger parameters');
  });

  it('5. Deletes client and verifies cascade deletion of all memories', async () => {
    await db.delete(clients).where(eq(clients.id, clientId));

    const checkMemories = await db
      .select()
      .from(clientMemories)
      .where(eq(clientMemories.clientId, clientId));

    expect(checkMemories.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test tests/e2e-client-memory.test.ts`
Expected: PASS

- [ ] **Step 3: Update documentation status**

Update `docs/PHASES.md` and `AGENTS.md` marking Phase 8 completed.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e-client-memory.test.ts docs/PHASES.md AGENTS.md
git commit -m "test(e2e): add Phase 8 client memory end-to-end integration test suite and mark complete"
```
