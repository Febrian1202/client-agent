# ADR-012: Docker Compose Strategy

**Date:** 2026-10-16
**Status:** Accepted

## Context

The project needs containerization for both local development and
production deployment. The production VPS (Dokploy) already runs
PostgreSQL and Redis as shared services.

## Decision

Two Docker Compose configurations:

- **Development** (`docker-compose.yml`): includes Postgres and Redis
  containers alongside the three application containers (api, web,
  worker).
- **Production** (`docker-compose.prod.yml`): includes only the three
  application containers. Postgres and Redis are provided by the VPS's
  existing services, connected via environment variables.

## Consequences

- Local development is self-contained: `docker compose up` starts
  everything.
- Production compose is lean: no duplicate database/cache services.
- Environment variables control the database and Redis connection
  strings, making the same application images work in both environments.
- Dokploy deploys the production compose file directly.
