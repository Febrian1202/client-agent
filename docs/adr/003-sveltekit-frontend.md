# ADR-003: SvelteKit Frontend

**Date:** 2026-10-16
**Status:** Accepted

## Context

The dashboard needs a frontend framework. The creator prefers SvelteKit
over Next.js.

## Decision

Use SvelteKit with Tailwind CSS, shadcn-svelte for components, and
Lucide for icons.

## Consequences

- TypeScript-first frontend consistent with the rest of the stack.
- Smaller bundle sizes compared to React.
- Less boilerplate.
- shadcn-svelte provides accessible, unstyled components that integrate
  well with Tailwind.
- The dashboard is a secondary priority (Phase 7). The frontend choice
  doesn't affect the backend or worker architecture.
