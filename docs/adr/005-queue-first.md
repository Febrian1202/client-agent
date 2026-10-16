# ADR-005: Queue-First Backend

**Date:** 2026-10-16
**Status:** Accepted

## Context

Several operations are slow or failure-prone: Playwright browser
automation (seconds), LLM calls (seconds), Gmail API (variable),
VGen page loads (seconds). Running these inside HTTP request handlers
would cause timeouts and poor UX.

## Decision

Long-running operations execute through Bun workers consuming Redis
Streams, not inside HTTP requests. The API validates input, persists
the task, publishes to a stream, and responds immediately with a
task ID.

## Consequences

- HTTP responses are fast (milliseconds).
- Workers can retry failed tasks independently.
- Workers can be restarted without losing tasks (Redis Streams
  persistence).
- The system is more resilient to individual operation failures.
- Adds complexity: task state management, consumer groups, dead-letter
  handling.
