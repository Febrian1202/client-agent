# Phase 7 — SvelteKit Dashboard: Step-by-Step Implementation Guide

> **Goal:** Build the visual web dashboard in SvelteKit using Tailwind CSS, shadcn-svelte components, and Lucide icons to monitor activity, read conversations, manage clients, and review/edit drafts.
> **Prerequisites:** Phases 0 through 6 completed.

---

## Architecture Context for This Phase

```text
Browser User (Creator)
       │
       ▼
apps/web (SvelteKit)
  - hooks.server.ts validates session cookie against API
  - Server load functions (+page.server.ts) fetch data from Elysia API
  - Client actions (+page.svelte) call Elysia API endpoints
       │
       ▼
apps/api (Elysia HTTP API: /api/v1/*)
  - /clients
  - /conversations
  - /drafts
  - /commissions
  - /agent/tasks
  - /integrations
  - /audit-log
```

The web app contains **no database queries** and **no business logic**. It acts purely as a typed presentation layer over the Elysia API.

---

## Page Priorities & Implementation Order

```text
Priority 1: Dashboard Shell & Auth Protection
    ↓
Priority 2: Agent Task Status Monitor (/agent)
    ↓
Priority 3: Conversation & Message Viewer (/conversations)
    ↓
Priority 4: Drafts & Approvals Manager (/drafts)
    ↓
Priority 5: Clients & Commission Tracker (/clients, /commissions)
    ↓
Priority 6: Integrations & Audit Log (/integrations, /audit-log)
```

---

## Atomic Task Breakdown

### Task 7.1: Auth Guard & Navigation Layout
- [ ] In `apps/web/src/hooks.server.ts`:
  - Intercept every request.
  - Read `session` cookie.
  - Forward request to `GET /api/v1/auth/me`.
  - If invalid and route is not `/login`, redirect to `/login`.
  - Populate `event.locals.user`.
- [ ] In `apps/web/src/routes/+layout.svelte`:
  - Build responsive sidebar navigation with shadcn-svelte and Lucide icons:
    - 📊 Dashboard (`/dashboard`)
    - 💬 Conversations (`/conversations`)
    - 📝 Drafts (`/drafts`)
    - 👥 Clients (`/clients`)
    - 🎨 Commissions (`/commissions`)
    - ⚡ Agent Tasks (`/agent`)
    - 🔌 Integrations (`/integrations`)
    - 📜 Audit Log (`/audit-log`)
  - User avatar/name display and Logout button in header.

---

### Task 7.2: Dashboard Home Overview (`/dashboard`)
- [ ] In `apps/web/src/routes/dashboard/+page.svelte`:
  - Stat cards (using shadcn-svelte Card):
    - New Messages count
    - Pending Reply Drafts count (with quick link to review)
    - Active Commissions count
    - Upcoming Deadlines count
  - Recent Activity Feed:
    - Lists latest 10 events/tasks with icons, client names, and time elapsed (e.g. "ErianOsamu → New Message 5m ago").

---

### Task 7.3: Agent Task Monitor (`/agent`)
- [ ] In `apps/web/src/routes/agent/+page.svelte`:
  - Table of recent background tasks from `GET /api/v1/agent/tasks`.
  - Columns: Task ID, Type, Status badge (`queued`, `running`, `completed`, `failed`, `dead`), Attempts, Created At, Action.
  - Click task to open sheet/dialog showing:
    - JSON input & output
    - Error message if failed
    - Retry button (calls `POST /api/v1/agent/tasks/:id/retry`)

---

### Task 7.4: Conversation & Message Viewer (`/conversations`)
- [ ] In `apps/web/src/routes/conversations/+page.svelte`:
  - Two-pane split view (like modern chat clients):
    - Left pane: Conversation list (Client username, last message snippet, sync timestamp).
    - Right pane: Active conversation thread.
- [ ] Thread details view (`/conversations/[id]`):
  - Message bubble list displaying inbound vs outbound messages with sender name and time.
  - "Sync from VGen" button (triggers `POST /api/v1/conversations/:id/sync`).
  - Quick action: "Generate AI Reply" input box (calls `POST /api/v1/agent/run`).

---

### Task 7.5: Drafts & Approvals Manager (`/drafts`)
- [ ] In `apps/web/src/routes/drafts/+page.svelte`:
  - Filter tabs: `Pending Approval`, `Approved`, `Sent`, `Rejected`.
  - Draft Card component:
    - Target client name & conversation link
    - AI-generated content in editable textarea
    - Actions:
      - `[Save Edits]` (calls `PATCH /api/v1/drafts/:id`)
      - `[Approve]` (calls `POST /api/v1/drafts/:id/approve`)
      - `[Reject]` (calls `POST /api/v1/drafts/:id/reject`)
      - `[Send to VGen]` (enabled only when approved, calls `POST /api/v1/drafts/:id/send`)
  - Visual toast alerts on action completions.

---

### Task 7.6: Clients & Commissions (`/clients` & `/commissions`)
- [ ] In `apps/web/src/routes/clients/+page.svelte`:
  - Client directory with search bar (`?search=...`).
  - Shows username, display name, platform (`vgen`), first seen, last seen dates.
  - Detail page (`/clients/[id]`): Client metadata, conversation links, commission history.
- [ ] In `apps/web/src/routes/commissions/+page.svelte`:
  - Kanban board or table of commissions:
    - Columns: `Requested`, `Accepted`, `In Progress`, `Delivered`, `Completed`.
    - Cards show service name, amount, client name, delivery date deadline.

---

### Task 7.7: Integrations & Audit Log (`/integrations` & `/audit-log`)
- [ ] In `apps/web/src/routes/integrations/+page.svelte`:
  - Connection status cards for:
    - Gmail (Pub/Sub connected / last sync time / reconnect button)
    - Discord Bot (online status / guild name / target channel)
  - VGen Browser Session status indicator (Session valid vs expired warning).
- [ ] In `apps/web/src/routes/audit-log/+page.svelte`:
  - Read-only table of immutable audit logs:
    - Timestamp, Actor (`user` / `agent`), Action (`USER_APPROVED_DRAFT`, `MESSAGE_SENT`, etc.), Target, IP address.

---

## Verification & Testing Steps

1. **Auth & Route Protection Test:**
   - Open browser in Incognito mode, navigate to `http://localhost:5173/dashboard`.
   - Verify immediate redirect to `/login`.
   - Login with valid credentials → redirect to `/dashboard`.

2. **Draft Review & Send Workflow via Web:**
   - In `/drafts`, view a draft with status `Pending Approval`.
   - Edit draft content in textarea, click `[Save Edits]`.
   - Click `[Approve]` → status badge updates to `Approved`, `[Send to VGen]` button becomes active.
   - Click `[Send to VGen]` → verify background task is created and toast indicates sending progress.

3. **Conversation Viewer Verification:**
   - Select conversation from left pane.
   - Verify messages render in proper chronological order with correct inbound/outbound styling.

---

## Done When Checklist
- [ ] All pages render with responsive layout, shadcn-svelte styling, and Lucide icons.
- [ ] Unauthorized users are redirected to the login page.
- [ ] Dashboard displays accurate summary metrics and real-time task statuses.
- [ ] Conversations and messages can be browsed and manually synced.
- [ ] Drafts can be reviewed, edited, approved, and dispatched directly from the web interface.
- [ ] Audit logs and integration statuses are visible and up-to-date.
