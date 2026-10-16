# ADR-001: Full TypeScript Stack

**Date:** 2026-10-16
**Status:** Accepted

## Context

The project is primarily an orchestration and automation system: API
requests, event processing, background jobs, browser automation, Gmail
API, Discord API, LLM API/tool calling, PostgreSQL, Redis, and a web
dashboard.

None of these workloads require Python-specific ML libraries.

## Decision

Use TypeScript across the entire stack: frontend (SvelteKit), backend
(Elysia), workers, browser automation (Playwright), all integrations,
and agent tooling.

## Consequences

- Shared types between frontend, backend, and workers.
- One runtime ecosystem (Bun).
- Simpler repository structure (Bun workspaces).
- Easier refactoring across package boundaries.
- Easier AI/tool integration (same language as tool definitions).
- Easier Playwright integration (native TypeScript).
- Less context switching.
- If significant Python-specific ML/data-processing needs arise later,
  a Python service can be added alongside.
