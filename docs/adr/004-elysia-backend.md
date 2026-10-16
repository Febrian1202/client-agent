# ADR-004: Elysia Backend

**Date:** 2026-10-16
**Status:** Accepted

## Context

The API layer needs a typed HTTP framework that runs on Bun.

## Decision

Use Elysia on Bun.

## Consequences

- Native Bun performance.
- End-to-end type safety with TypeBox schemas.
- Lightweight — no heavy framework abstractions.
- Plugin ecosystem for common middleware (cors, rate limiting, etc.).
- Request validation built into route definitions.
- Strong fit with the queue-first architecture: Elysia validates and
  enqueues, workers execute.
