# ClientAgent — Product Record

> **Date:** 2026-10-16

---

## Audience

A solo creator who manages client commissions on VGen. Non-technical
in the sense that they should not need to understand queues, browser
automation, or prompt engineering to use the system. They interact
primarily through Discord and occasionally through a web dashboard.

## Main Task

Know when a client reaches out, understand what they need, draft a
reply, and send it — without manually checking Gmail and VGen
throughout the day.

## Constraint

Use real conversation content retrieved from VGen. Do not invent or
fabricate message content, client details, or conversation history.
Never send a message the creator has not explicitly approved.

---

## Context

The creator sells art commissions on VGen. Clients contact them through
VGen's messaging system. VGen sends notification emails to Gmail when
something happens — a new message, a new commission request, a status
change.

Today the creator's workflow is:

1. Notice a notification email in Gmail (or miss it).
2. Open VGen in a browser.
3. Find the right conversation.
4. Read what the client said.
5. Think about a reply.
6. Type and send it.
7. Repeat for every client, every day.

The gap is between step 1 and step 4. The creator spends time on
context-switching — leaving their creative work to check emails, open
VGen, find the right thread, re-read the conversation to remember
where things left off. For active clients this happens multiple times
a day.

ClientAgent closes that gap. It watches Gmail, tells the creator who
wrote and what type of event it is, pulls the conversation when asked,
summarizes it, and drafts a reply. The creator reviews, edits if needed,
approves, and the system sends it. The creator stays in Discord (where
they already spend time) instead of juggling Gmail and VGen tabs.

## What the Creator Cares About

- **Speed of awareness.** Know within minutes that a client sent a
  message, not hours.
- **Accuracy.** The right client, the right conversation, the right
  context. Wrong-target errors are unacceptable.
- **Control.** Nothing goes out without approval. The agent assists,
  it does not act.
- **Tone.** Drafts should match the creator's communication style —
  concise, friendly, professional. Not robotic, not overly formal.
- **Privacy.** Client conversations are private. The system should
  minimize exposure of client data.

## What the Creator Does Not Care About

- Multi-tenancy or serving other creators.
- A polished public-facing marketing site.
- Mobile app.
- Real-time collaborative editing.
- Complex role-based access control.

## Scale

One creator. Roughly 5–20 active clients at any given time. A few
messages per day, not thousands. Commission volume is measured in
single digits per week. The system does not need to handle high
throughput — it needs to be reliable and correct.
