# Phase 7 — SvelteKit Dashboard: Step-by-Step Implementation Guide

> **Goal:** Build the visual web dashboard in SvelteKit using Tailwind CSS, shadcn-svelte components, and Lucide icons to monitor activity, read conversations, manage clients, review/edit drafts, and track detailed commission orders.
> **Prerequisites:** Phases 0 through 6 completed.

---

## 🎨 Design System & UI Mockup Authority (MANDATORY)

Any session or AI agent implementing Phase 7 **MUST STRICTLY ADHERE** to the official design tokens and mockup:

1. **Design Tokens (`DESIGN.md`):**
   - **Background:** `#ddf4ff` (pale sky-blue canvas).
   - **Cards & Surfaces:** `#ffffff` (crisp white containers with `#c7e8fa` 2px subtle borders).
   - **Subtle Surface / Insets:** `#f4faff` (brief boxes, message bubbles, draft previews).
   - **Primary CTA / Buttons:** `#a5ed6e` (vibrant lime green) with `#111111` (`on-primary`) bold text.
   - **Accent / Interactive:** `#1cb0f6` (bright cyan-blue for links, active nav, order tags).
   - **Status Colors:** Orange `#ff9600` (in queue/action needed), Purple `#af71f5` (drafts/review), Green `#58cc02` (success/active), Red `#ff4b4b` (declined/error).
   - **Text:** `#3c3c3c` (charcoal, bold 600-700) for optimal contrast; `#777777` for secondary/muted text.
   - **Corner Radius:** `12px` (`rounded-xl`) universally for cards, buttons, badges, and avatars.
   - **Base Spacing:** 10px / 20px multiples.

2. **Official Canvas UI Mockup (`docs/pen/ui.pen`):**
   - The interactive visual mockup for the dashboard is preserved in `docs/pen/ui.pen` (accessible via the `pencil` MCP tool).
   - **Do NOT invent a generic dark theme or alter the layout structure.** The layout consists of:
     - Fixed Sidebar (250px) with logo, navigation with notification badges, live integration status indicators, and creator profile.
     - Top Header with Page Title, Subtitle, "Sync VGen" button, and "Review Drafts" primary CTA.
     - 4 Metric Cards Row (Active Commissions, In Queue / Requested, Completed Month, Pending Approval).
     - Dominant Two-Column Split:
       - **Left (Major):** Commission Pipeline & Client Briefs with status tabs, order IDs, pricing, countdown deadlines, and full **Client Note & Brief Summary** callout boxes.
       - **Right (Aside):** Draft Requiring Approval (7-Point Safety Gate + SHA-256 lock + Fact Grounding), Recent Inbound Messages, and Active Client Memory Profile (`FACT` vs `PREFERENCE` vs `INFERENCE`).

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

### Task 7.1: Auth Guard & Navigation Layout (Matches `docs/pen/ui.pen`)
- [x] In `apps/web/src/hooks.server.ts`:
  - Intercept every request.
  - Read `session` cookie.
  - Forward request to `GET /api/v1/auth/me`.
  - If invalid and route is not `/login`, redirect to `/login`.
  - Populate `event.locals.user`.
- [x] In `apps/web/src/routes/+layout.svelte`:
  - Root canvas container styled with `bg-[#ddf4ff]` and font Inter / duolingo-sans.
  - Responsive Sidebar navigation (`w-[250px]` bg-white with 12px rounded items):
    - Brand container: ClientAgent logo badge with bot icon (`#a5ed6e`), title, and "VGen Creator Studio" subtitle (`#1cb0f6`).
    - Navigation items with notification counter badges:
      - 📊 Dashboard (`/dashboard`)
      - 💼 Commissions (`/commissions`, badge `5`)
      - 💬 Conversations (`/conversations`, badge `2`)
      - 📝 Drafts & Approvals (`/drafts`, badge `3`)
      - 👥 Clients (`/clients`)
      - ⚡ Agent Tasks (`/agent`, badge `1 active`)
      - 🔌 Integrations (`/integrations`)
      - 🛡️ Audit Log (`/audit-log`)
    - Sidebar Bottom status card:
      - VGen Session indicator (Active)
      - Gmail Pub/Sub indicator (Listening)
      - Discord Bot indicator (Online)
    - Creator profile card: avatar, display name ("Erian Osamu"), handle ("@erianosamu"), and logout button.

---

### Task 7.2: Dashboard Home Overview (`/dashboard` — Directly Implements `docs/pen/ui.pen`)
- [x] In `apps/web/src/routes/dashboard/+page.svelte`:
  - **Header Row:**
    - Page Title ("Dashboard Overview") & Subtitle summarizing active items.
    - Quick actions: "Sync VGen" button (outline) and "Review Drafts (3)" primary CTA (`#a5ed6e`).
  - **4 Top Metric Cards (12px rounded white cards):**
    - Active Commissions (`5 Active` • `$1,850 USD in pipeline` • badge `In Progress`)
    - In Queue / Requested (`3 In Queue` • `Awaiting your acceptance` • badge `Action Needed`)
    - Completed (Month) (`18 Finished` • `100% on-time delivery rate` • badge `100% Success`)
    - Pending Approval (`3 Drafts` • `Safety Gate: 7/7 checks passed` • badge `Human Control`)
  - **Main Split Area (2 Columns):**
    - **Left Column (Major): Commission Pipeline & Client Briefs**
      - Header with filter tabs: `All (8)`, `Active (5)`, `In Queue (3)`, `Delivered (1)`.
      - Commission Card component for each commission:
        - Top row: Service name, status badge, and price formatted in USD (e.g. `$850.00 USD`).
        - Meta row: Client avatar & username (e.g. `@KitsuneMei`), order ID (`#VG-8941`), and deadline countdown (e.g. `Guaranteed: Oct 28, 2026 (7 days remaining)`).
        - **Client Note & Brief Summary Box (`bg-[#f4faff]` rounded-xl):** displays the detailed brief, instructions, and reference links provided by the client.
        - Contextual action buttons: `[Open Thread]`, `[Accept Commission]`, `[Update Stage]`, `[Mark Completed]`.
    - **Right Column (Aside, 380px): Safety Gate & Real-time Context**
      - **Draft Requiring Approval Card:**
        - Header with `7/7 Gate Passed` badge.
        - Client and order context (`Reply to @KitsuneMei`).
        - Editable draft text box with 1.4 line-height.
        - Safety verification indicators: `SHA-256 Verified` and `Grounded: Timezone UTC+9`.
        - Primary action button `[Approve and Dispatch]` (`#a5ed6e` with `#111111` bold text) and `[Edit]` button.
      - **Recent Inbound Messages Card:**
        - List of latest messages with unread dot indicators, client usernames, message snippets, and relative timestamps (e.g. `8m ago`).
      - **Client Memory Profile Card (Phase 8 bridge):**
        - Live context pills highlighting `FACT` (verified facts), `PREFERENCE` (work habits), and `INFERENCE` (AI deductions).

---

### Task 7.3: Agent Task Monitor (`/agent`)
- [x] In `apps/web/src/routes/agent/+page.svelte`:
  - Table of recent background tasks from `GET /api/v1/agent/tasks`.
  - Columns: Task ID, Type, Status badge (`queued`, `running`, `completed`, `failed`, `dead`), Attempts, Created At, Action.
  - Click task to open sheet/dialog showing:
    - JSON input & output
    - Error message if failed
    - Retry button (calls `POST /api/v1/agent/tasks/:id/retry`)

---

### Task 7.4: Conversation & Message Viewer (`/conversations`)
- [x] In `apps/web/src/routes/conversations/+page.svelte`:
  - Two-pane split view (like modern chat clients):
    - Left pane: Conversation list (Client username, last message snippet, sync timestamp).
    - Right pane: Active conversation thread.
- [x] Thread details view (`/conversations/[id]`):
  - Message bubble list displaying inbound vs outbound messages with sender name and time.
  - "Sync from VGen" button (triggers `POST /api/v1/conversations/:id/sync`).
  - Quick action: "Generate AI Reply" input box (calls `POST /api/v1/agent/run`).

---

### Task 7.5: Drafts & Approvals Manager (`/drafts`)
- [x] In `apps/web/src/routes/drafts/+page.svelte`:
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
- [x] In `apps/web/src/routes/clients/+page.svelte`:
  - Client directory with search bar (`?search=...`).
  - Shows username, display name, platform (`vgen`), first seen, last seen dates.
  - Detail page (`/clients/[id]`): Client metadata, conversation links, commission history.
- [x] In `apps/web/src/routes/commissions/+page.svelte`:
  - Kanban board or table of commissions:
    - Columns: `Requested`, `Accepted`, `In Progress`, `Delivered`, `Completed`.
    - Cards show service name, amount, client name, delivery date deadline.

---

### Task 7.7: Integrations & Audit Log (`/integrations` & `/audit-log`)
- [x] In `apps/web/src/routes/integrations/+page.svelte`:
  - Connection status cards for:
    - Gmail (Pub/Sub connected / last sync time / reconnect button)
    - Discord Bot (online status / guild name / target channel)
  - VGen Browser Session status indicator (Session valid vs expired warning).
- [x] In `apps/web/src/routes/audit-log/+page.svelte`:
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
- [x] All pages render with responsive layout, shadcn-svelte styling, and Lucide icons.
- [x] Unauthorized users are redirected to the login page.
- [x] Dashboard displays accurate summary metrics and real-time task statuses.
- [x] Conversations and messages can be browsed and manually synced.
- [x] Drafts can be reviewed, edited, approved, and dispatched directly from the web interface.
- [x] Audit logs and integration statuses are visible and up-to-date.
