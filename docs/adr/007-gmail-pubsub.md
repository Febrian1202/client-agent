# ADR-007: Gmail API + Pub/Sub

**Date:** 2026-10-16
**Status:** Accepted

## Context

The system needs to detect VGen notification emails. Options: polling
Gmail, Gmail API push via Pub/Sub, Google Apps Script forwarding.

## Decision

Use Gmail API with Google Cloud Pub/Sub for the production event
architecture. Apps Script is acceptable for early prototyping but is
not the target.

## Consequences

- Near real-time email detection (Pub/Sub push, not polling).
- Fits the event-driven backend architecture.
- Requires Google Cloud project setup (Pub/Sub topic, subscription,
  service account or OAuth).
- The Pub/Sub notification is a mailbox-change signal, not the email
  itself — the backend must fetch the actual email via Gmail API.
- Gmail API watch must be renewed periodically (every 7 days).
