# ADR-009: Human Approval for External Writes

**Date:** 2026-10-16
**Status:** Accepted

## Context

The system can generate reply drafts and send them on VGen. Autonomous
sending risks impersonation, wrong-target errors, and loss of creator
trust.

## Decision

All external write operations (sending messages on VGen) require
explicit human approval by default.

## Consequences

- The creator maintains full control over external communication.
- Every sent message has an approval record and audit trail.
- Adds latency to the reply flow (creator must approve each draft).
- The creator can edit drafts before approving them.
- An edited draft invalidates any previous approval.
- This can be relaxed later for specific low-risk scenarios if the
  creator chooses, but the default is always human approval.
