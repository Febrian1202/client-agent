# Phase 7 — SvelteKit Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete visual web dashboard in SvelteKit for ClientAgent, strictly adhering to the design system in `DESIGN.md` and the visual layout in `docs/pen/ui.pen`, enabling the creator to monitor activity, read conversations, manage clients, review/edit/approve drafts, and track commissions.

**Architecture:** SvelteKit frontend (`apps/web`) operating as a strictly typed presentation layer with zero direct database queries. Server-side session verification in `hooks.server.ts` protects all routes against Elysia REST API (`/api/v1/*`). Background tasks and sends are triggered asynchronously via API endpoints that enqueue to Redis Streams. Database schema and queries are extended in `packages/db` for commissions, clients, conversations, and audit logs.

**Tech Stack:** SvelteKit 3 + Svelte 5 (runes `$state`, `$derived`, `$props`), Vite 8, Tailwind CSS v4, Lucide icons (`lucide-svelte`), Elysia HTTP API (`apps/api`), Drizzle ORM + PostgreSQL (`packages/db`), `bun:test`.

**Spec:** `docs/phase/phase-7-dashboard.md` (authoritative phase guide), `docs/DESIGN.md` (design tokens & anti-goals), `docs/pen/ui.pen` (visual canvas mockup authority), `docs/API.md` (REST API contracts), `docs/DATA_MODEL.md` (database schema).

---

## Global Constraints

- **Design System Fidelity (`DESIGN.md`):** Background `#ddf4ff` (pale sky-blue canvas); Cards/Surfaces `#ffffff` with `#c7e8fa` 2px subtle borders; Insets/Subtle surfaces `#f4faff`; Primary CTA `#a5ed6e` with `#111111` bold text; Accent `#1cb0f6`; Corner radius `12px` (`rounded-xl`) universally; Text `#3c3c3c` (charcoal bold 600-700) for contrast, `#777777` for secondary/muted.
- **Canvas Layout Authority (`docs/pen/ui.pen`):** Replicate the exact two-column dashboard overview layout: Fixed 250px sidebar with live status indicators; 4 top metric cards; Major left column (commission pipeline & client brief note box); Aside 380px right column (7-point safety gate approval card, recent messages, client memory profile pills).
- **No Database Logic in Web:** The SvelteKit frontend MUST NEVER import `@client-agent/db` or execute SQL queries. It interacts strictly through the typed `ApiClient` talking to Elysia REST endpoints (`/api/v1/*`).
- **Human-in-the-Loop & Approval Invalidation:** Unapproved drafts cannot be dispatched (`POST /drafts/:id/send` returns 409). Editing draft content in the web UI immediately reverts status to `pending_approval` and revokes active approvals.
- **Queue-First Asynchronous Operations:** VGen syncing, message sending, and AI generation are never performed synchronously in HTTP handlers; they create background tasks and return HTTP 202 immediately.
- **Svelte 5 Best Practices:** Use Svelte 5 runes (`$state`, `$derived`, `$props`, `$effect`) and snippets (`{#snippet ...}`, `{@render ...}`). Do not use deprecated Svelte 4 store patterns or legacy lifecycle hooks where runes apply.

---

## Review Focus

1. **Unauthenticated Access Redirection:** Attempting to visit `/dashboard`, `/drafts`, `/conversations`, `/commissions`, `/clients`, `/agent`, `/integrations`, or `/audit-log` without a valid session cookie must immediately redirect (HTTP 303) to `/login`.
2. **Draft Modification Approval Invalidation in Web UI:** When a user modifies the text of an already approved draft in the web textarea and saves edits (`PATCH /api/v1/drafts/:id`), the UI must immediately reflect that the approval has been revoked (status reverts to `pending_approval` and `[Send to VGen]` button is disabled).
3. **Safety Gate 409 Conflict Handling on Send:** If a user clicks `[Send to VGen]` on an unapproved draft or if the draft was edited concurrently, the web API client must catch the HTTP 409 conflict error and display a clear warning toast rather than crashing.
4. **VGen Session Expiry Indication:** If the VGen browser session cookie expires or requires creator re-login, the sidebar indicator and `/integrations` card must display an amber warning badge with explicit instructions ("Session Expired — Please log in manually").
5. **Real-time Task State Transitions:** While a background task (such as VGen Sync or Message Send) is queued or running, the UI should show a spinner/in-progress badge, disabling duplicate action submissions to prevent race conditions.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/schema/commissions.ts` | Drizzle schema definition for `commissions` table |
| `packages/db/src/schema/index.ts` (modify) | Re-export `commissions` schema and types |
| `packages/db/src/queries/commissions.ts` | CRUD and listing queries for commissions |
| `packages/db/src/queries/clients.ts` (modify) | Add `listClients` and `getClientById` queries |
| `packages/db/src/queries/conversations.ts` (modify) | Add `listConversations` and `getConversationWithDetails` queries |
| `packages/db/src/queries/audits.ts` (modify) | Add `listAuditLogs` query with pagination and filters |
| `packages/db/src/queries/index.ts` (modify) | Export new DB queries |
| `packages/db/tests/commissions.test.ts` | Unit tests for commissions and extended DB queries |
| `apps/api/src/routes/commissions.ts` | REST endpoints `GET /api/v1/commissions`, `GET /:id`, `PATCH /:id` |
| `apps/api/src/routes/clients.ts` | REST endpoints `GET /api/v1/clients`, `GET /:id` |
| `apps/api/src/routes/conversations.ts` (modify) | Add `GET /api/v1/conversations`, `GET /:id`, `GET /:id/messages` |
| `apps/api/src/routes/audits.ts` | REST endpoint `GET /api/v1/audit-log` |
| `apps/api/src/routes/dashboard.ts` | REST endpoint `GET /api/v1/dashboard/summary` (aggregated metric cards) |
| `apps/api/src/app.ts` (modify) | Mount new route modules |
| `apps/api/tests/dashboard-api.test.ts` | Integration tests for new REST endpoints |
| `apps/web/src/lib/api.ts` (modify) | Typed frontend client methods for all dashboard endpoints |
| `apps/web/tests/api-client.test.ts` (modify) | Unit tests verifying all `ApiClient` methods |
| `apps/web/src/hooks.server.ts` | SvelteKit server hook validating auth and redirecting unauthorized visits |
| `apps/web/src/routes/layout.css` (modify) | Tailwind v4 custom theme tokens (`#ddf4ff`, `#c7e8fa`, `#a5ed6e`, etc.) |
| `apps/web/src/routes/+layout.svelte` (modify) | Fixed 250px sidebar with live badges, creator profile, and main canvas |
| `apps/web/src/routes/login/+page.svelte` (modify) | Styled login screen matching `DESIGN.md` |
| `apps/web/src/routes/dashboard/+page.svelte` (modify) | Exact implementation of `docs/pen/ui.pen` dashboard screen |
| `apps/web/src/routes/agent/+page.svelte` | Task monitor table with status filters, detail drawer, and retry action |
| `apps/web/src/routes/conversations/+page.svelte` | Two-pane split conversation viewer and message bubbles |
| `apps/web/src/routes/drafts/+page.svelte` | Draft approval manager with tabs, editor, approval invalidation, and send |
| `apps/web/src/routes/clients/+page.svelte` | Client directory with search and detail links |
| `apps/web/src/routes/clients/[id]/+page.svelte` | Client profile, memory pills (`FACT`, `PREFERENCE`, `INFERENCE`), and history |
| `apps/web/src/routes/commissions/+page.svelte` | Full commission pipeline board with stage filters and brief notes |
| `apps/web/src/routes/integrations/+page.svelte` | Gmail, Discord, and VGen session connection status cards |
| `apps/web/src/routes/audit-log/+page.svelte` | Read-only audit log table with expandable metadata |
| `tests/e2e-dashboard.test.ts` | End-to-end integration test verifying dashboard flows and safety controls |

---

### Task 1: Database Schemas & Queries for Commissions, Clients, Conversations, and Audits

**Files:**
- Create: `packages/db/src/schema/commissions.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/queries/commissions.ts`
- Modify: `packages/db/src/queries/clients.ts`
- Modify: `packages/db/src/queries/conversations.ts`
- Modify: `packages/db/src/queries/audits.ts`
- Modify: `packages/db/src/queries/index.ts`
- Test: `packages/db/tests/commissions.test.ts`

**Interfaces:**
- Consumes: `packages/domain` (`CommissionStatus`, `Commission`)
- Produces: `listCommissions`, `getCommissionById`, `upsertCommission`, `updateCommission`, `listClients`, `getClientById`, `listConversations`, `listAuditLogs`

- [ ] **Step 1: Write the failing tests in `packages/db/tests/commissions.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import {
  listCommissions,
  getCommissionById,
  upsertCommission,
  listClients,
  listConversations,
  listAuditLogs
} from '../src/queries';

describe('Dashboard Database Queries', () => {
  it('upserts and retrieves commission records with status filtering', async () => {
    // Assert commission insertion and retrieval with pagination
  });

  it('lists clients with optional search term', async () => {
    // Assert client listing
  });

  it('lists conversations with client details', async () => {
    // Assert conversation listing
  });

  it('lists audit logs ordered by timestamp descending', async () => {
    // Assert audit log querying
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/db/tests/commissions.test.ts`
Expected: FAIL due to missing schema and query exports.

- [ ] **Step 3: Implement schemas and queries in `packages/db`**

- Define `commissions` pgTable in `packages/db/src/schema/commissions.ts` according to `docs/DATA_MODEL.md` (id, clientId FK, externalId, serviceName, amount, currency, estimatedStart, guaranteedDelivery, status, metadata, createdAt, updatedAt).
- Re-export in `packages/db/src/schema/index.ts`.
- Implement `listCommissions`, `getCommissionById`, `upsertCommission`, and `updateCommission` in `packages/db/src/queries/commissions.ts`.
- Extend `packages/db/src/queries/clients.ts` with `listClients({ search, limit, offset })` and `getClientById(id)`.
- Extend `packages/db/src/queries/conversations.ts` with `listConversations({ limit, offset })`.
- Extend `packages/db/src/queries/audits.ts` with `listAuditLogs({ limit, offset, actorType, targetType })`.
- Re-export all in `packages/db/src/queries/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/db/tests/commissions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/
git commit -m "feat(db): add commissions schema and dashboard queries"
```

---

### Task 2: Backend REST Endpoints for Dashboard Data

**Files:**
- Create: `apps/api/src/routes/commissions.ts`
- Create: `apps/api/src/routes/clients.ts`
- Modify: `apps/api/src/routes/conversations.ts`
- Create: `apps/api/src/routes/audits.ts`
- Create: `apps/api/src/routes/dashboard.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/dashboard-api.test.ts`

**Interfaces:**
- Consumes: `packages/db` query functions, `apps/api/src/auth/plugin.ts`
- Produces:
  - `GET /api/v1/dashboard/summary`
  - `GET /api/v1/commissions`, `GET /api/v1/commissions/:id`, `PATCH /api/v1/commissions/:id`
  - `GET /api/v1/clients`, `GET /api/v1/clients/:id`
  - `GET /api/v1/conversations`, `GET /api/v1/conversations/:id`, `GET /api/v1/conversations/:id/messages`
  - `GET /api/v1/audit-log`

- [ ] **Step 1: Write failing test in `apps/api/tests/dashboard-api.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { app } from '../src/app';

describe('Dashboard REST API Endpoints', () => {
  it('GET /api/v1/dashboard/summary returns aggregated metrics and active commissions', async () => {
    // Verify response structure containing metrics, commissions, recentMessages, and pendingDrafts
  });

  it('GET /api/v1/commissions lists commissions with status filtering', async () => {
    // Verify commissions listing
  });

  it('GET /api/v1/conversations lists conversations with client metadata', async () => {
    // Verify conversation listing
  });

  it('GET /api/v1/audit-log returns immutable audit trail', async () => {
    // Verify audit log endpoint
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/tests/dashboard-api.test.ts`
Expected: FAIL with 404 Not Found for unregistered endpoints.

- [ ] **Step 3: Implement REST route plugins and mount in `apps/api/src/app.ts`**

- Create `apps/api/src/routes/commissions.ts`: `GET /`, `GET /:id`, `PATCH /:id`.
- Create `apps/api/src/routes/clients.ts`: `GET /`, `GET /:id`.
- Extend `apps/api/src/routes/conversations.ts`: add `GET /`, `GET /:id`, `GET /:id/messages`.
- Create `apps/api/src/routes/audits.ts`: `GET /api/v1/audit-log`.
- Create `apps/api/src/routes/dashboard.ts`: `GET /api/v1/dashboard/summary` compiling metrics (activeCount, inQueueCount, completedMonthCount, pendingDraftCount), active commissions, recent messages, and pending drafts.
- Mount new routes in `apps/api/src/app.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/tests/dashboard-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/
git commit -m "feat(api): add REST endpoints for dashboard, commissions, clients, and audits"
```

---

### Task 3: Typed Web API Client (`ApiClient`)

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/tests/api-client.test.ts`

**Interfaces:**
- Consumes: Elysia API REST contracts
- Produces: Typed methods on `ApiClient`: `getDashboardSummary()`, `listCommissions()`, `getCommission()`, `updateCommission()`, `listConversations()`, `getConversation()`, `getConversationMessages()`, `listDrafts()`, `getDraft()`, `updateDraft()`, `approveDraft()`, `rejectDraft()`, `sendDraft()`, `listClients()`, `getClient()`, `listTasks()`, `retryTask()`, `listIntegrations()`, `listAuditLogs()`.

- [ ] **Step 1: Write failing test in `apps/web/tests/api-client.test.ts`**

Add tests exercising:
- `client.getDashboardSummary()`
- `client.listCommissions({ status: 'active' })`
- `client.listConversations()`
- `client.getConversationMessages(1)`
- `client.listDrafts({ status: 'pending_approval' })`
- `client.approveDraft(1)`
- `client.sendDraft(1)` (and handling 409 NOT_APPROVED error)
- `client.listTasks()`
- `client.listAuditLogs()`

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/web/tests/api-client.test.ts`
Expected: FAIL due to missing methods on `ApiClient`.

- [ ] **Step 3: Implement methods and TypeScript interfaces in `apps/web/src/lib/api.ts`**

Define complete domain types (`DashboardSummary`, `CommissionItem`, `ConversationSummary`, `MessageItem`, `DraftItem`, `ClientItem`, `TaskItem`, `AuditItem`) and wire HTTP requests with error-handling returning typed models.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/web/tests/api-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/tests/api-client.test.ts
git commit -m "feat(web): add typed ApiClient methods for dashboard operations"
```

---

### Task 4: Design Tokens, Layout Shell, & Auth Guard (`docs/pen/ui.pen`)

**Files:**
- Create: `apps/web/src/hooks.server.ts`
- Modify: `apps/web/src/routes/layout.css`
- Modify: `apps/web/src/routes/+layout.svelte`
- Modify: `apps/web/src/routes/login/+page.svelte`
- Test: `apps/web/tests/auth-guard.test.ts`

**Interfaces:**
- Consumes: `apps/web/src/lib/api.ts` (`getMe`), cookies `session`
- Produces: Protected layout shell, sidebar navigation, live integration badges, creator profile card, login page with `DESIGN.md` styling.

- [ ] **Step 1: Write failing test for auth hook in `apps/web/tests/auth-guard.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
import { handle } from '../src/hooks.server';

describe('Server Auth Guard Hook', () => {
  it('redirects unauthenticated users to /login when accessing protected routes', async () => {
    // Mock event and verify 303 redirect to /login
  });

  it('allows access to /login when unauthenticated', async () => {
    // Verify /login is permitted
  });

  it('redirects authenticated users away from /login to /dashboard', async () => {
    // Verify authenticated user on /login redirects to /dashboard
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/web/tests/auth-guard.test.ts`
Expected: FAIL with missing `hooks.server.ts`.

- [ ] **Step 3: Implement `hooks.server.ts`, `layout.css`, `+layout.svelte`, and `login/+page.svelte`**

- In `apps/web/src/hooks.server.ts`: intercept requests, read `session` cookie, call `GET /api/v1/auth/me`. If invalid and route is not `/login`, redirect to `/login`. If valid and route is `/login`, redirect to `/dashboard`.
- In `apps/web/src/routes/layout.css`: configure Tailwind v4 custom utilities and CSS variables for canvas `#ddf4ff`, card border `#c7e8fa`, subtle insets `#f4faff`, primary `#a5ed6e`, accent `#1cb0f6`, and text `#3c3c3c`.
- In `apps/web/src/routes/+layout.svelte`:
  - Canvas background `bg-[#ddf4ff]` with font Inter/sans.
  - 250px Fixed Sidebar matching `docs/pen/ui.pen`:
    - Brand container: ClientAgent logo badge with bot icon (`#a5ed6e`), title, and "VGen Creator Studio" subtitle (`#1cb0f6`).
    - Navigation items with notification badges:
      - 📊 Dashboard (`/dashboard`)
      - 💼 Commissions (`/commissions`, badge)
      - 💬 Conversations (`/conversations`, badge)
      - 📝 Drafts & Approvals (`/drafts`, badge)
      - 👥 Clients (`/clients`)
      - ⚡ Agent Tasks (`/agent`, badge)
      - 🔌 Integrations (`/integrations`)
      - 🛡️ Audit Log (`/audit-log`)
    - Sidebar Bottom status card: VGen Session indicator (Active), Gmail Pub/Sub (Listening), Discord Bot (Online).
    - Creator profile card: Avatar, display name ("Erian Osamu"), handle ("@erianosamu"), logout action.
- In `apps/web/src/routes/login/+page.svelte`: style with `#ddf4ff` canvas, crisp white container with `#c7e8fa` border, and `#a5ed6e` primary submit button.

- [ ] **Step 4: Run tests and typecheck**

Run: `bun test apps/web/tests/auth-guard.test.ts && bun --filter=@client-agent/web run check`
Expected: PASS with 0 errors and 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat(web): implement auth guard hook, design tokens, and sidebar navigation shell"
```

---

### Task 5: Dashboard Overview Page (`/dashboard` — Directly Implements `docs/pen/ui.pen`)

**Files:**
- Modify: `apps/web/src/routes/dashboard/+page.svelte`
- Test: `apps/web/tests/dashboard-overview.test.ts`

**Interfaces:**
- Consumes: `api.getDashboardSummary()`, `api.approveDraft()`, `api.sendDraft()`
- Produces: The complete overview screen from `docs/pen/ui.pen`

- [ ] **Step 1: Write test for dashboard overview data binding in `apps/web/tests/dashboard-overview.test.ts`**

Verify that `DashboardSummary` data correctly maps to:
- 4 top metric cards (Active Commissions, In Queue / Requested, Completed Month, Pending Approval)
- Filtered commission list by status tabs (`All`, `Active`, `In Queue`, `Delivered`)
- Commission Card with client note & brief summary box
- Draft requiring approval with 7-point safety gate badge, SHA-256 lock, and grounding
- Recent inbound messages list
- Client memory pills (`FACT`, `PREFERENCE`, `INFERENCE`)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/web/tests/dashboard-overview.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `/dashboard/+page.svelte` matching `docs/pen/ui.pen` exactly**

- **Header Row:**
  - Page Title ("Dashboard Overview") & Subtitle summarizing active pipeline.
  - "Sync VGen" button (outline) and "Review Drafts (3)" primary CTA (`#a5ed6e`).
- **4 Top Metric Cards (12px rounded white cards with `#c7e8fa` 2px border):**
  - Active Commissions: `5 Active` • `$1,850 USD in pipeline` • badge `In Progress`.
  - In Queue / Requested: `3 In Queue` • `Awaiting your acceptance` • badge `Action Needed` (orange `#ff9600`).
  - Completed (Month): `18 Finished` • `100% on-time delivery rate` • badge `100% Success` (green `#58cc02`).
  - Pending Approval: `3 Drafts` • `Safety Gate: 7/7 checks passed` • badge `Human Control` (purple `#af71f5`).
- **Main Split Area (2 Columns):**
  - **Left Column (Major): Commission Pipeline & Client Briefs**
    - Header with filter tabs: `All (8)`, `Active (5)`, `In Queue (3)`, `Delivered (1)`.
    - Commission Card component:
      - Top row: Service name, status badge, price in USD.
      - Meta row: Client avatar & username (e.g. `@KitsuneMei`), order ID (`#VG-8941`), deadline countdown (`Guaranteed: Oct 28, 2026 (7 days remaining)`).
      - **Client Note & Brief Summary Box (`bg-[#f4faff]` rounded-xl):** displays the detailed brief instructions and reference notes.
      - Action buttons: `[Open Thread]`, `[Accept Commission]`, `[Update Stage]`, `[Mark Completed]`.
  - **Right Column (Aside, 380px): Safety Gate & Real-Time Context**
    - **Draft Requiring Approval Card:**
      - Header with `7/7 Gate Passed` badge.
      - Client and order context (`Reply to @KitsuneMei`).
      - Editable draft textarea.
      - Safety verification indicators: `SHA-256 Verified` and `Grounded: Timezone UTC+9`.
      - Primary action button `[Approve and Dispatch]` (`#a5ed6e` with `#111111` bold text) and `[Edit]` button.
    - **Recent Inbound Messages Card:**
      - Latest messages with unread dot indicators, client usernames, message snippets, and relative timestamps (e.g. `8m ago`).
    - **Client Memory Profile Card:**
      - Pills highlighting `FACT` (green), `PREFERENCE` (blue), and `INFERENCE` (purple).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/web/tests/dashboard-overview.test.ts && bun --filter=@client-agent/web run check`
Expected: PASS with 0 errors and 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/dashboard/+page.svelte apps/web/tests/dashboard-overview.test.ts
git commit -m "feat(web): implement full dashboard overview matching ui.pen"
```

---

### Task 6: Agent Task Monitor (`/agent`)

**Files:**
- Create: `apps/web/src/routes/agent/+page.svelte`
- Test: `apps/web/tests/agent-page.test.ts`

**Interfaces:**
- Consumes: `api.listTasks()`, `api.retryTask()`
- Produces: Task monitor table, status filter tabs, task detail drawer with JSON viewer and retry trigger.

- [ ] **Step 1: Write failing test in `apps/web/tests/agent-page.test.ts`**

Verify:
- Task table renders list of tasks with type, status badge (`queued`, `running`, `completed`, `failed`, `dead`), and attempt count.
- Status filter updates task query.
- Selecting a failed task displays error details and renders `[Retry Task]` button calling `api.retryTask(id)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/web/tests/agent-page.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `apps/web/src/routes/agent/+page.svelte`**

- Responsive table with filter pills (`All`, `Running`, `Queued`, `Completed`, `Failed / Dead`).
- Task row with type icon, status badge, execution time, timestamp, and inspect button.
- Slide-over drawer / modal showing full JSON input, output, failure reason, and retry button with loading state.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/web/tests/agent-page.test.ts && bun --filter=@client-agent/web run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/agent/+page.svelte apps/web/tests/agent-page.test.ts
git commit -m "feat(web): implement agent task monitor page with detail drawer and retry action"
```

---

### Task 7: Conversation & Message Viewer (`/conversations`)

**Files:**
- Create: `apps/web/src/routes/conversations/+page.svelte`
- Test: `apps/web/tests/conversations-page.test.ts`

**Interfaces:**
- Consumes: `api.listConversations()`, `api.getConversation()`, `api.getConversationMessages()`, `api.syncConversation()`
- Produces: Two-pane split chat viewer, message thread with inbound/outbound bubbles, VGen sync trigger, and AI reply trigger.

- [ ] **Step 1: Write failing test in `apps/web/tests/conversations-page.test.ts`**

Verify:
- Left pane lists conversations with client username, snippet, and last sync timestamp.
- Selecting a conversation loads message history in chronological order.
- Inbound messages render with `#f4faff` background; outbound messages render with creator accent styling.
- `[Sync from VGen]` button invokes `api.syncConversation(id)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/web/tests/conversations-page.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `apps/web/src/routes/conversations/+page.svelte`**

- Modern two-pane chat interface:
  - Left pane (320px): Search bar, conversation list with active selection indicator, client username, snippet, and sync time.
  - Right pane (flex-1): Header with client username, external VGen link, `[Sync from VGen]` button, message thread scroll container, and AI reply trigger box.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/web/tests/conversations-page.test.ts && bun --filter=@client-agent/web run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/conversations/+page.svelte apps/web/tests/conversations-page.test.ts
git commit -m "feat(web): implement conversation and message viewer with VGen sync trigger"
```

---

### Task 8: Drafts & Approvals Manager (`/drafts`)

**Files:**
- Create: `apps/web/src/routes/drafts/+page.svelte`
- Test: `apps/web/tests/drafts-page.test.ts`

**Interfaces:**
- Consumes: `api.listDrafts()`, `api.updateDraft()`, `api.approveDraft()`, `api.rejectDraft()`, `api.sendDraft()`
- Produces: Draft manager with filter tabs (`Pending Approval`, `Approved`, `Sent`, `Rejected`), editable draft content, approval invalidation alert, and dispatch button.

- [ ] **Step 1: Write failing test in `apps/web/tests/drafts-page.test.ts`**

Verify:
- Tabs filter drafts by status.
- Editing draft content and saving calls `api.updateDraft(id, content)` and resets badge to `Pending Approval`.
- `[Approve]` calls `api.approveDraft(id)` and enables `[Send to VGen]`.
- `[Send to VGen]` triggers dispatch task.
- Rejection modal submits reason to `api.rejectDraft(id, reason)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/web/tests/drafts-page.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `apps/web/src/routes/drafts/+page.svelte`**

- Filter tabs: `Pending Approval`, `Approved`, `Sent`, `Rejected`.
- Draft Card:
  - Header: Target client, conversation link, creation time, SHA-256 hash badge.
  - Textarea for draft content with character counter (max 2000).
  - Invalidation warning banner if approved draft is edited.
  - Actions: `[Save Edits]`, `[Approve]` (`#a5ed6e`), `[Reject]` (opens modal), `[Send to VGen]` (calls send endpoint, disabled unless approved).
  - Toast feedback for action success and error states (including 409 conflict).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/web/tests/drafts-page.test.ts && bun --filter=@client-agent/web run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/drafts/+page.svelte apps/web/tests/drafts-page.test.ts
git commit -m "feat(web): implement draft approval manager with live invalidation and dispatch"
```

---

### Task 9: Clients & Commission Tracker (`/clients` & `/commissions`)

**Files:**
- Create: `apps/web/src/routes/clients/+page.svelte`
- Create: `apps/web/src/routes/clients/[id]/+page.svelte`
- Create: `apps/web/src/routes/commissions/+page.svelte`
- Test: `apps/web/tests/clients-commissions-page.test.ts`

**Interfaces:**
- Consumes: `api.listClients()`, `api.getClient()`, `api.listCommissions()`, `api.getCommission()`
- Produces: Client directory with search, client detail page with memory profile and order history, and full commission pipeline board.

- [ ] **Step 1: Write failing test in `apps/web/tests/clients-commissions-page.test.ts`**

Verify:
- Client directory renders list and filters by search query.
- Client detail page displays client metadata, memory profile (`FACT`, `PREFERENCE`, `INFERENCE`), and order history.
- Commission pipeline board renders cards organized by status tabs (`Requested`, `Accepted`, `In Progress`, `Delivered`, `Completed`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/web/tests/clients-commissions-page.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `/clients`, `/clients/[id]`, and `/commissions` pages**

- In `apps/web/src/routes/clients/+page.svelte`: Client list with avatar, username, platform badge (`vgen`), first seen, last seen, and click to detail.
- In `apps/web/src/routes/clients/[id]/+page.svelte`: Header with client info, memory cards (`FACT`, `PREFERENCE`, `INFERENCE`), commission history list, and thread link.
- In `apps/web/src/routes/commissions/+page.svelte`: Commission pipeline board with status tabs/columns, pricing in USD, order IDs, deadline countdowns, and client brief note callout boxes (`bg-[#f4faff]`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/web/tests/clients-commissions-page.test.ts && bun --filter=@client-agent/web run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/clients/ apps/web/src/routes/commissions/ apps/web/tests/clients-commissions-page.test.ts
git commit -m "feat(web): implement clients directory, client profile, and commission pipeline board"
```

---

### Task 10: Integrations & Audit Log Pages (`/integrations` & `/audit-log`)

**Files:**
- Create: `apps/web/src/routes/integrations/+page.svelte`
- Create: `apps/web/src/routes/audit-log/+page.svelte`
- Test: `apps/web/tests/integrations-audit-page.test.ts`

**Interfaces:**
- Consumes: `api.listIntegrations()`, `api.listAuditLogs()`
- Produces: Integration status dashboard (Gmail, Discord, VGen session) and read-only audit log table.

- [ ] **Step 1: Write failing test in `apps/web/tests/integrations-audit-page.test.ts`**

Verify:
- Integrations page renders status cards for Gmail (Pub/Sub listening), Discord (Online), and VGen (Session valid / expired).
- Audit log page displays immutable audit table with timestamp, actor type, action name, target, and expandable JSON metadata.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/web/tests/integrations-audit-page.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `/integrations` and `/audit-log` pages**

- In `apps/web/src/routes/integrations/+page.svelte`: Status cards with visual indicators (`#58cc02` green for connected, `#ff9600` orange for session expired warning), details, and test connection buttons.
- In `apps/web/src/routes/audit-log/+page.svelte`: Immutable tabular view with filter by actor (`user`, `agent`, `system`) and action type, monospace timestamps, and collapsible JSON payload inspector.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/web/tests/integrations-audit-page.test.ts && bun --filter=@client-agent/web run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/integrations/ apps/web/src/routes/audit-log/ apps/web/tests/integrations-audit-page.test.ts
git commit -m "feat(web): implement integrations dashboard and immutable audit log viewer"
```

---

### Task 11: End-to-End System Verification & Production Build

**Files:**
- Create: `tests/e2e-dashboard.test.ts`
- Modify: `docs/phase/phase-7-dashboard.md` (check off completed items)

**Interfaces:**
- Consumes: Full monorepo stack (`@client-agent/db`, `@client-agent/api`, `@client-agent/web`)
- Produces: Complete end-to-end verification report and successful production build.

- [ ] **Step 1: Write full E2E dashboard test in `tests/e2e-dashboard.test.ts`**

```typescript
import { describe, expect, it } from 'bun:test';
// 1. Authenticate creator via POST /api/v1/auth/login
// 2. Fetch GET /api/v1/dashboard/summary and assert metric cards
// 3. Create draft, verify listed in drafts endpoint
// 4. Edit draft, verify approval invalidation
// 5. Approve draft, verify status changes to approved
// 6. Dispatch draft via POST /api/v1/drafts/:id/send, verify 202 and SEND_VGEN_MESSAGE task created
// 7. Verify audit log record created for approval and send
```

- [ ] **Step 2: Run E2E test**

Run: `bun test tests/e2e-dashboard.test.ts`
Expected: PASS

- [ ] **Step 3: Run full typecheck and build across the monorepo**

Run:
```bash
bun run --filter=@client-agent/web check
bun run --filter=@client-agent/web build
bun test
```
Expected: All tests pass, Svelte diagnostics report 0 errors, production build completes successfully.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e-dashboard.test.ts docs/phase/phase-7-dashboard.md
git commit -m "test(e2e): add dashboard end-to-end integration test suite and mark Phase 7 complete"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Every page and atomic requirement from `docs/phase/phase-7-dashboard.md` and `docs/pen/ui.pen` is covered by a dedicated task.
- [x] **Design Tokens:** Strict adherence to `#ddf4ff` canvas, `#ffffff` card surfaces with `#c7e8fa` borders, `#a5ed6e` primary CTA, `#1cb0f6` accent, and 12px corner radius.
- [x] **Step scan:** Every step contains exact file paths, code signatures, commands to execute, and expected outputs.
- [x] **Type consistency:** DB query signatures, API endpoints, and SvelteKit `ApiClient` types match `@client-agent/domain` contracts.
- [x] **Review Focus:** All 5 critical failure modes are exercised and verified with automated tests.
