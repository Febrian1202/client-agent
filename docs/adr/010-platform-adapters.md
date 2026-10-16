# ADR-010: Platform Adapter Pattern

**Date:** 2026-10-16
**Status:** Accepted

## Context

The agent core needs to interact with VGen (and potentially other
platforms in the future). Coupling the agent directly to VGen's browser
DOM structure would make the agent fragile and hard to extend.

## Decision

Isolate platform-specific logic behind a `PlatformAdapter` interface.
The agent core calls `adapter.getConversation()` and gets structured
data back, without knowing whether it came from a browser, an API, or
a mock.

## Consequences

- Agent core does not import Playwright or know about browser automation.
- VGen UI changes only affect `VGenBrowserAdapter`, not the agent.
- Future platforms or an official VGen API can be added as new adapters.
- Testing is easier: mock adapters for unit tests, real adapters for
  integration tests.
- Slight indirection cost, but worth it for maintainability.
