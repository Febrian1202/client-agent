# ADR-011: Single-User Authentication

**Date:** 2026-10-16
**Status:** Accepted

## Context

This is a personal tool for one creator. Multi-tenant auth (OAuth
providers, registration flow, user management) adds complexity without
value.

## Decision

Single-user authentication with username and password. The credentials
are stored as environment variables (password as a hash). On successful
login, a session ID is created in Redis with a TTL. The session ID is
returned as an HTTP-only cookie.

## Consequences

- No registration page, no user management UI.
- Simple implementation: one login endpoint, one session check middleware.
- Password changes require updating the environment variable and
  restarting.
- The `users` table still exists for foreign key integrity and to avoid
  a painful migration if multi-user is ever needed.
- Rate limiting on the login endpoint prevents brute-force attempts.
