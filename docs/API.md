# ClientAgent — API Specification

> **Date:** 2026-10-16

---

## General

- **Base URL:** `/api/v1`
- **Format:** JSON
- **Auth:** Session cookie (HTTP-only, set after login)
- **Errors:** Consistent error envelope

### Error Format

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid session"
  }
}
```

### Pagination

List endpoints accept `?page=1&limit=20` and return:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42
  }
}
```

---

## Authentication

### POST /auth/login

Login with username and password. Returns a session cookie.

```json
// Request
{
  "username": "ridaz",
  "password": "..."
}

// Response 200
{
  "user": {
    "id": 1,
    "name": "Ridaz",
    "email": "ridaz@example.com"
  }
}
// Set-Cookie: session=<id>; HttpOnly; Secure; SameSite=Strict
```

### POST /auth/logout

Destroy the current session.

```json
// Response 200
{ "ok": true }
```

### GET /auth/me

Return the currently authenticated user.

```json
// Response 200
{
  "user": {
    "id": 1,
    "name": "Ridaz",
    "email": "ridaz@example.com"
  }
}
```

---

## Clients

### GET /clients

List all clients. Supports `?search=`, `?platform=`, pagination.

### GET /clients/:id

Get a single client with recent activity summary.

### POST /clients

Manually create a client record.

### PATCH /clients/:id

Update client metadata (display name, notes, etc.).

### DELETE /clients/:id

Soft-delete or archive a client.

---

## Conversations

### GET /clients/:clientId/conversations

List conversations for a client.

### GET /conversations/:id

Get a single conversation with metadata.

### GET /conversations/:id/messages

List messages in a conversation. Supports pagination, `?order=asc|desc`.

### POST /conversations/:id/sync

Trigger a conversation sync from VGen. Creates a task, returns task ID.

```json
// Response 202
{
  "taskId": "task_123",
  "status": "queued"
}
```

---

## Commissions

### GET /commissions

List commissions. Supports `?status=`, `?client_id=`, pagination.

### GET /commissions/:id

Get a single commission with details.

### PATCH /commissions/:id

Update commission metadata.

### POST /commissions/:id/sync

Trigger commission sync from VGen.

---

## Agent

### POST /agent/run

Send a natural-language instruction to the agent. The API creates a
task and returns immediately. Execution happens in the worker.

```json
// Request
{
  "message": "Read ErianOsamu's latest conversation and summarize it"
}

// Response 202
{
  "taskId": "task_456",
  "status": "queued"
}
```

### GET /agent/tasks

List agent tasks. Supports `?status=`, `?type=`, pagination.

### GET /agent/tasks/:id

Get task details including status, output, and error information.

### GET /agent/runs/:id

Get a specific AI run with input, output, token usage, and timing.

---

## Drafts

### GET /drafts

List drafts. Supports `?status=`, `?conversation_id=`, pagination.

### GET /drafts/:id

Get a single draft with conversation context.

### POST /drafts

Manually create a draft for a conversation.

```json
{
  "conversationId": 1,
  "content": "Hi, thanks for reaching out..."
}
```

### PATCH /drafts/:id

Edit a draft's content. If the draft was previously approved, the
approval is invalidated.

### POST /drafts/:id/approve

Approve a draft for sending.

```json
// Response 200
{
  "draft": { "id": 1, "status": "approved", "approvedAt": "..." }
}
```

### POST /drafts/:id/reject

Reject a draft.

```json
// Request (optional)
{
  "reason": "Too formal"
}
```

### POST /drafts/:id/send

Send an approved draft. Validates the approval is still valid, creates
a SEND_VGEN_MESSAGE task.

```json
// Response 202
{
  "taskId": "task_789",
  "status": "queued"
}
```

Returns 409 if draft is not approved or approval was invalidated.

---

## Integrations

### GET /integrations

List all integrations and their connection status.

### POST /integrations/gmail

Initiate Gmail OAuth flow or store credentials.

### DELETE /integrations/gmail

Disconnect Gmail integration.

### POST /integrations/discord

Configure Discord bot connection.

### DELETE /integrations/discord

Disconnect Discord integration.

### POST /integrations/telegram

Configure Telegram bot connection.

### DELETE /integrations/telegram

Disconnect Telegram integration.

---

## Webhooks

These endpoints are called by external services, not by the dashboard.

### POST /webhooks/google/gmail

Receives Google Cloud Pub/Sub push notifications when Gmail mailbox
changes. Validates the Pub/Sub message, fetches the relevant email,
parses it, and enqueues processing.

No session auth — verified by Pub/Sub signature/audience.

### POST /webhooks/discord

Receives Discord interaction webhooks (slash command responses, button
clicks). Verified by Discord signature.

### POST /webhooks/telegram

Receives Telegram bot updates. Verified by Telegram secret.

---

## Health

### GET /health

Basic health check. No auth required.

```json
{
  "status": "ok",
  "timestamp": "2026-10-16T12:00:00Z"
}
```

### GET /health/ready

Readiness check — verifies database and Redis connections.

```json
{
  "status": "ready",
  "database": "ok",
  "redis": "ok"
}
```
