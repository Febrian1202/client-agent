# ADR-008: Browser Automation for VGen

**Date:** 2026-10-16
**Status:** Accepted

## Context

VGen does not provide a public API. The system needs to read
conversations and send messages. The notification emails do not
contain the actual conversation content.

## Decision

Use Playwright browser automation through a VGen adapter, only when
no appropriate official API is available.

## Constraints

- Never store the VGen password.
- User manually authenticates in a dedicated browser profile.
- Worker reuses the session from that profile.
- Session expiry pauses tasks and notifies the creator.
- Never bypass CAPTCHA, 2FA, or anti-bot mechanisms.
- Never circumvent rate limits or platform security controls.

## Consequences

- The system can read conversations and send messages on VGen.
- Fragile: VGen UI changes can break the adapter.
- Requires a running browser instance in the worker.
- Session management adds operational complexity.
- If VGen releases an API, the browser adapter is replaced without
  changing the agent core (PlatformAdapter interface).
