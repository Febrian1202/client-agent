# ClientAgent — Design Document

> **Status:** Approved
> **Date:** 2026-10-16
> **Author:** Ridaz + AI collaborator

---

## Intent

ClientAgent is a personal AI agent that helps a creator manage client
communication on VGen. It monitors incoming notifications, retrieves
conversations, summarizes them, drafts replies, and sends approved
messages — all under human control.

The creator is a single user. This is not a multi-tenant SaaS product.
It is a personal tool that runs on the creator's own infrastructure.

### Why This Exists

Managing client communication on VGen is manual and repetitive:

1. VGen sends a notification email when something happens.
2. The creator opens Gmail, reads the notification.
3. The creator opens VGen, finds the conversation.
4. The creator reads the conversation, decides what to reply.
5. The creator types and sends the reply.

ClientAgent automates the detection and reading steps, assists with
drafting, and executes sending — but only after explicit human approval.

### Why Now

The creator has enough active clients that manually monitoring emails and
switching between Gmail and VGen is becoming a bottleneck. An AI agent
that handles the routine parts (detect, read, summarize, draft) frees
the creator to focus on the actual creative work.

---

## Goals

### Primary

- Detect VGen notification emails automatically via Gmail API.
- Identify the client and event type from each notification.
- Notify the creator through Discord (primary control channel).
- Retrieve VGen conversations when requested.
- Store normalized conversation data.
- Summarize conversations with AI.
- Generate response drafts.
- Accept natural-language instructions from the creator.
- Allow editing, approval, and rejection of drafts.
- Send approved messages through VGen.
- Maintain client and commission context.
- Keep every important agent action observable and auditable.

### Secondary (Later)

- Web dashboard for visual management.
- Telegram as additional notification/control channel.
- Client memory (preferences, communication style, history).
- Commission lifecycle tracking.
- Multiple platform adapters beyond VGen.
- Metrics and operational monitoring.
- AI draft quality evaluation.

---

## Non-Goals

These are things the system will explicitly **not** do:

- Automatically reply to clients without human approval.
- Store the VGen password.
- Bypass CAPTCHA, 2FA, or anti-bot mechanisms.
- Circumvent rate limits or platform security controls.
- Perform mass scraping.
- Perform autonomous financial transactions.
- Modify commissions without user approval.
- Hide agent activity from the account owner.
- Claim that the AI is a human operator.

---

## Anti-Goals

Things that would make this a failure even if it technically works:

- **Silent impersonation.** The agent sends messages the creator never
  saw or approved. This is the worst failure mode.
- **Duplicate actions.** The same notification produces two Discord
  messages, or an approved message gets sent twice.
- **Wrong target.** A reply intended for Client A gets sent to Client B.
- **Data loss.** Conversations or client data disappear without trace.
- **Opacity.** The creator cannot understand what the agent did or why.

---

## Constraints

### Single User

This is a personal tool. There is one user (the creator). Auth is
username + password stored in environment variables, with sessions in
Redis. There is no registration flow, no multi-tenancy, no user
management UI.

### VGen Has No Public API

VGen does not offer a public API for reading conversations or sending
messages. The system uses browser automation (Playwright) as a fallback
integration mechanism. This means:

- The creator manually authenticates in a dedicated browser profile.
- The worker reuses that session.
- If the session expires, the system pauses and notifies the creator.
- The system never bypasses security mechanisms.

If VGen introduces an API in the future, a new adapter replaces the
browser adapter without changing the agent core.

### Infrastructure

- Deployment target: creator's VPS via Dokploy.
- PostgreSQL and Redis already exist on the VPS — production Docker
  Compose does not include them.
- Development Docker Compose includes Postgres + Redis for local work.
- Runtime: Bun everywhere.

### Human-in-the-Loop by Default

Every external write operation (sending a message on VGen) requires
explicit approval. The system follows:

```
DETECT → READ → UNDERSTAND → DRAFT → HUMAN APPROVAL → EXECUTE
```

The agent assists. It does not act autonomously on external platforms.

---

## How the Creator Uses It

### Daily Flow

1. Client sends a message on VGen.
2. VGen sends a notification email to Gmail.
3. Gmail Pub/Sub pushes an event to the Elysia API.
4. The system parses the event, identifies the client and event type.
5. Discord bot sends the creator a notification:
   `🔔 New VGen Message from @ErianOsamu`
6. Creator types `/read ErianOsamu` in Discord.
7. System retrieves the conversation from VGen via Playwright.
8. System summarizes the conversation and shows it in Discord.
9. Creator types `/reply ErianOsamu tell them I can start next week`.
10. Agent drafts a reply based on conversation context + instruction.
11. Draft appears in Discord with [Approve] [Edit] [Reject] buttons.
12. Creator approves (or edits, then approves).
13. System sends the message on VGen, verifies it was sent, logs it.
14. Creator gets confirmation in Discord.

### When Things Go Wrong

- **Session expired:** System pauses the task, notifies creator to
  re-authenticate, resumes when session is valid again.
- **Ambiguous send failure:** System does NOT retry blindly. It checks
  whether the message already appeared in the conversation.
- **Low confidence:** Agent asks for clarification instead of guessing.
- **Wrong client detected:** System asks creator to confirm before
  taking action.

---

## What Success Looks Like

For the first milestone (event pipeline only, no AI, no browser):

> A VGen notification email produces exactly one corresponding Discord
> notification, every time, with no duplicates.

For the full system:

| Metric | Target |
|--------|--------|
| Notification detection | ≥ 95% |
| Duplicate processing | 0 |
| Unapproved external sends | 0 |
| Correct conversation match | ≥ 95% |
| Successful browser reads | ≥ 90% |
| Successful approved sends | ≥ 95% |

---

## Decisions Made by the Creator

These were explicitly chosen, not defaults:

| Decision | Choice | Why |
|----------|--------|-----|
| Language | TypeScript everywhere | Orchestration system, not ML. One language across stack. |
| Runtime | Bun | Fast TS runtime, built-in workspaces, test runner. |
| Frontend | SvelteKit | Creator preference. |
| CSS | Tailwind CSS | Creator preference. |
| Components | shadcn-svelte | Creator preference. |
| Icons | Lucide for Svelte | Creator preference. |
| Backend | Elysia | Typed, lightweight, runs on Bun. |
| ORM | Drizzle | Type-safe, explicit queries. |
| Queue | Redis Streams | Simple, built into Redis, explicit consumer model. |
| Auth | Username + password session | Single-user, no OAuth complexity for app auth. |
| Deploy | Dokploy on VPS | Creator's existing infrastructure. |
| Dev infra | Docker Compose with Postgres + Redis | Consistent local environment. |
| Prod infra | Docker Compose without Postgres + Redis | Use existing VPS services. |
| Primary channel | Discord | Creator's preferred communication tool. |

---

## Decisions Left to the Builder

- Exact Drizzle migration strategy (push vs. generate+migrate).
- Session library choice (or hand-rolled with Redis).
- Exact Docker base images.
- Port assignments for local development.
- Elysia plugin choices (cors, rate-limit, etc.).
- SvelteKit adapter choice (node vs. bun).
- Exact shadcn-svelte components to install upfront.
- Test file organization within packages.
- Git branching strategy.
- CI/CD pipeline specifics.
