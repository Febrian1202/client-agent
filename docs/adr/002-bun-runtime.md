# ADR-002: Bun Runtime

**Date:** 2026-10-16
**Status:** Accepted

## Context

The project needs a TypeScript runtime for API, workers, and tooling.
Options: Node.js, Deno, Bun.

## Decision

Use Bun as the runtime and package manager.

## Consequences

- Fast startup and execution.
- Built-in TypeScript support without separate compilation step.
- Built-in test runner (`bun test`).
- Built-in workspaces for monorepo.
- Built-in bundler for production builds.
- Some npm packages may have compatibility issues, though this is
  increasingly rare.
