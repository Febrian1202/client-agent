# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A solo digital creator who sells commissions on VGen. Non-technical regarding system architecture (browser automation, background queues, prompt orchestration). Operates with 5–20 active clients at a time and single-digit weekly commissions, requiring reliable, low-overhead communication assistance.

## Product Purpose

Eliminate manual context-switching between Gmail notifications and VGen conversation threads. ClientAgent monitors incoming inquiries in real time, synchronizes and summarizes conversation history, drafts contextual replies in the creator's voice, and dispatches messages to VGen only after explicit human review and approval.

## Positioning

A personal, single-tenant creator automation assistant with an inviolable 7-point safety gate. Unlike generic chatbots or bulk auto-responders, ClientAgent never sends unapproved messages, bypasses no platform authentication or security mechanisms, fabricates no facts, and runs on the creator's self-hosted infrastructure.

## Operating Context

- **Discord (Primary Control Channel):** Real-time inquiry alerts, `/summarize`, `/reply`, and `/read` commands, interactive approval/rejection buttons, and draft edit modals.
- **Web Dashboard (SvelteKit):** System readiness monitoring, background task inspection (`/agent`), conversation thread exploration (`/conversations`), draft review and dispatch (`/drafts`), client and commission tracking, and immutable audit logs.
- **VGen Messaging Platform:** Target platform for commission inquiries and client messaging, accessed via persistent authenticated browser session context (`BROWSER_PROFILE_PATH`).
- **Gmail API & Google Cloud Pub/Sub:** Real-time push notifications triggering the ingestion and parsing pipeline.

## Capabilities and Constraints

- **Human-in-the-Loop for External Writes:** The agent must never send a message on VGen or any external platform without explicit human approval. Post-approval edits immediately revoke approval status.
- **The 7-Point Safety Gate:** Every dispatch validates target conversation ID, target client username, creator identity, approved status, matching SHA-256 contentHash, active approval state, and fresh conversation state (no unread client messages sent after draft creation).
- **No Password Storage & No Anti-Bot Bypassing:** No VGen credentials stored in code or database. Reuses the creator's manual login profile; pauses tasks and alerts the creator via Discord if the session expires.
- **Queue-First Architecture:** Long-running browser automation, LLM inference, and Gmail synchronization execute strictly inside `apps/worker` via Redis Streams; HTTP API routes remain lightweight and non-blocking.
- **Strict Deduplication & Idempotency:** Deduplicates Gmail notification message IDs (`events.external_id`) and validates task idempotency keys before execution.
- **Immutable Audit Trail:** Append-only audit logs recording every critical state transition, draft approval, edit, and send dispatch.
- **Factual Grounding:** Distinguishes verified facts (`FACT`), observed patterns (`PREFERENCE`), and hypotheses (`INFERENCE`). Intent ambiguities trigger `LOW_CONFIDENCE` flags and creator clarification.

## Brand Commitments

- **Name:** ClientAgent.
- **Tone & Voice:** Concise, friendly, and professional. Matches the creator's natural client-facing communication style while avoiding robotic, overly formal, or sycophantic phrasing.

## Evidence on Hand

- Verified system specifications: `docs/PRODUCT.md`, `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/API.md`.
- Completed architectural phases (Phases 0–6) including event ingestion, worker hardening, VGen Playwright reader, LLM orchestration, approval state machine, and browser send automation with safety gates.
- Source codebase: SvelteKit 5 + Tailwind CSS web dashboard (`apps/web`), Elysia backend (`apps/api`), standalone background worker (`apps/worker`), and domain/platform packages.

## Product Principles

1. **Control Before Speed:** Automation prepares and assists, but never speaks on the creator's behalf without explicit human verification and approval.
2. **Accurate Context Over Generic Output:** Ground all drafts and summaries strictly in verified VGen conversation history and factual client records.
3. **Zero Administrative Overhead:** Free the creator to focus on creative work; keep alerts clean in Discord and provide a clear, noise-free dashboard.
4. **Fail Safe and Transparent:** When sessions expire, ambiguities arise, or safety checks fail, pause execution immediately, alert the creator, and log the reason immutably.

## Accessibility & Inclusion

Web dashboard adheres to WCAG 2.2 standards, ensuring semantic HTML structure, keyboard navigability, high-contrast dark theme palettes, clear interactive states, and legible typography across desktop and mobile viewports.
