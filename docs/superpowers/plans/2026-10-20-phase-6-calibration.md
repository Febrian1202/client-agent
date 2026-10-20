# Phase 6 Calibration: Auto-Dispatch, URL Normalization & Live Thread Handling

> **Goal:** Complete the live integration of Phase 6 VGen Send so that clicking `[Approve ✅]` in Discord automatically enqueues and delivers messages to VGen, with resilient creator username normalization (handling URLs in `.env`) and proper chat drawer opening in Playwright.
> **Architecture Rules:**
> - Strict 7-Point Safety Gate before browser action.
> - No blind retries on ambiguity (DOM reload verification).
> - Clean domain boundaries.

---

### Task 1: Robust Creator Username Normalization in Domain Safety Gate
- **Files:**
  - `packages/domain/src/safety/safetyGate.ts`
  - `packages/domain/tests/safetyGate.test.ts`
- **Objective:**
  Allow `expectedCreatorUsername` or `authenticatedCreatorUsername` to be formatted as `https://vgen.co/r1daz_`, `http://vgen.co/r1daz_`, `@r1daz_`, or `r1daz_`. Extract the username slug cleanly.
- **Steps:**
  1. Add unit tests for URL-formatted and slug-formatted creator usernames in `safetyGate.test.ts`.
  2. Implement `normalizeCreatorUsername` helper in `safetyGate.ts`.
  3. Verify all tests pass in `packages/domain`.

---

### Task 2: VGen Live Profile Extraction & Thread Drawer Opening in VGen Adapter
- **Files:**
  - `packages/vgen/src/selectors.ts`
  - `packages/vgen/src/adapter.ts`
  - `packages/vgen/tests/send.test.ts`
- **Objective:**
  1. `getAuthenticatedUsername`: Detect profile links like `a.profileLinkButton` or `a[href^="https://vgen.co/"][target="_blank"]` and extract slug (skipping non-profile pages like `invite-codes`).
  2. `sendMessage`: If `conversationUrl` does not match `THREAD_URL_PATTERN` (e.g. `https://vgen.co/creator/commissions`), call `openThread(page, input.clientUsername)` to open the Stream Chat drawer.
- **Steps:**
  1. Write failing tests in `packages/vgen/tests/send.test.ts`.
  2. Implement selector and adapter logic in `packages/vgen/src/`.
  3. Verify tests pass.

---

### Task 3: Discord Approve Button Auto-Dispatch to `STREAMS.SEND`
- **Files:**
  - `packages/discord/src/interactions/draftInteractions.ts`
  - `packages/discord/src/components/draftButtons.ts`
  - `packages/discord/tests/draft-components.test.ts`
  - `apps/worker/src/bot.ts`
  - `apps/worker/tests/reply-draft-approval.test.ts`
- **Objective:**
  When `approve_draft` button is clicked in Discord:
  1. Approve draft in DB.
  2. Create `SEND_VGEN_MESSAGE` task with idempotency key.
  3. Publish task to `STREAMS.SEND`.
  4. Update Discord embed message to `✅ Approved by Creator — ⏳ Sending to VGen...`.
- **Steps:**
  1. Write failing tests in `packages/discord/tests/draft-components.test.ts` and `apps/worker/tests/reply-draft-approval.test.ts`.
  2. Implement changes in `draftInteractions.ts` and `apps/worker/src/bot.ts`.
  3. Verify tests pass.

---

### Task 4: Full E2E & Monorepo Verification
- **Files:**
  - `tests/e2e-vgen-send.test.ts`
- **Objective:**
  Run `bun test` and `bun run typecheck` across all packages to guarantee zero regressions.
