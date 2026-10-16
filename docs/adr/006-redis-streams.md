# ADR-006: Redis Streams for Queue

**Date:** 2026-10-16
**Status:** Accepted

## Context

The system needs asynchronous task processing. Options: BullMQ (Redis
based, mature), Redis Streams (lower-level, built into Redis), RabbitMQ,
dedicated queue services.

## Decision

Use Redis Streams directly as the queue/event-processing mechanism.

## Consequences

- No additional infrastructure — Redis is already required for sessions.
- Explicit consumer group model with acknowledgment.
- Built-in message persistence (unlike Redis Pub/Sub).
- Lower-level than BullMQ — requires implementing retry logic, dead
  letter handling, and consumer management.
- Can be replaced with BullMQ or another queue library later if
  operational complexity justifies it, since the queue abstraction is
  in its own package.
