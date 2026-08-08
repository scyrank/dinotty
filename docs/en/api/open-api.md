# Open API (Terminal I/O)

The Open API is a low-level HTTP interface for reading terminal screens and scrollback, writing raw input to a pane, and resizing panes. It does not create or destroy tabs/panes - that's the [Tabs & Panes API](./tabs-panes-api.md)'s job.

## Table of Contents

- [Overview](#overview)
- [Enable Switch](#enable-switch)
- [Authentication](#authentication)
- [Endpoints](#endpoints)
  - [GET /api/sessions](#get-apisessions)
  - [GET /api/sessions/:pane_id/screen](#get-apisessionspane_idscreen)
  - [GET /api/sessions/:pane_id/scrollback](#get-apisessionspane_idscrollback)
  - [POST /api/sessions/:pane_id/input](#post-apisessionspane_idinput)
  - [POST /api/sessions/:pane_id/resize](#post-apisessionspane_idresize)
  - [POST /api/input](#post-apiinput)
- [Difference from Agent API](#difference-from-agent-api)
- [Error Format](#error-format)

---

## Overview

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List sessions | `GET /api/sessions` | Metadata for all PTY sessions + active_pane_id |
| Read screen | `GET /api/sessions/:pane_id/screen` | Current visible area (plain / ansi) |
| Read scrollback | `GET /api/sessions/:pane_id/scrollback` | Last N lines of history |
| Write input | `POST /api/sessions/:pane_id/input` | Inject bytes into a specific pane |
| Resize | `POST /api/sessions/:pane_id/resize` | Change PTY cols/rows |
| Write to active pane | `POST /api/input` | Falls back to active pane when `pane_id` is omitted |

The Open API operates on existing PTY sessions. To create new sessions, use the [Tabs API](./tabs-panes-api.md).

---

## Enable Switch

The Open API is disabled by default. Set `open_api.enabled = true` to unlock `/api/sessions/*` and `/api/input`.

```bash
curl -X PUT -H "Authorization: Bearer <token>" \
     http://localhost:8999/api/settings \
     -d '{"open_api":{"enabled":true}, /* ...echo other settings back */ }'
```

When disabled, every Open API endpoint returns:

```json
{ "error": "open_api is disabled" }
```

HTTP 403.

---

## Authentication

The Open API uses the global auth middleware:

- **Session Cookie**: browser same-origin contexts
- **Bearer Token**: `Authorization: Bearer <global-token>`

The Open API does **not** support Agent Tokens (fine-grained capability tokens). If you need per-permission authorization, use the [Agent API](./agent-api.md) instead - it supports `terminal:read` / `terminal:write` capabilities.

---

## Endpoints

### GET /api/sessions

List all PTY sessions.

**Response (200):**

```json
{
  "sessions": [
    {
      "pane_id": "pane-1",
      "tab_id": "tab-aaa",
      "shell_type": "zsh",
      "status": "connected",
      "size": { "cols": 120, "rows": 32 },
      "cwd": "/Users/dev/project"
    },
    {
      "pane_id": "pane-2",
      "tab_id": "tab-bbb",
      "shell_type": "ssh",
      "status": "detached",
      "size": { "cols": 80, "rows": 24 },
      "cwd": null
    }
  ],
  "active_pane_id": "pane-1"
}
```

`status` values:

- `connected` - PTY is alive
- `detached` - PTY has exited but the layout hasn't been cleaned up yet

`cwd` is the working directory the server derived from shell integration (OSC 7 / synchronized probing); may be `null` for SSH sessions or shells without integration.

---

### GET /api/sessions/:pane_id/screen

Read the current visible screen.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `format` | string | `plain` | `plain` strips ANSI; `ansi` preserves colors and cursor sequences |

**Response (200):**

```json
{
  "pane_id": "pane-1",
  "content": "$ ls -la\ntotal 0\ndrwxr-xr-x  2 dev  staff   64 Aug  8 10:00 .\n",
  "size": { "cols": 120, "rows": 32 }
}
```

`content` is a newline-joined string. `ansi` mode is good for recording / replaying terminal frames; `plain` is good for log scraping and regex matching.

---

### GET /api/sessions/:pane_id/scrollback

Read scrollback history.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `lines` | int | 200 (ansi) / all (plain) | Last N lines to return |
| `format` | string | `plain` | `plain` / `ansi` |

**Response (200):**

```json
{
  "pane_id": "pane-1",
  "lines": [
    "$ npm install",
    "added 312 packages in 4s",
    "$ npm run build",
    "> build",
    "> esbuild src/main.ts --bundle"
  ],
  "total": 1247
}
```

`total` is the scrollback buffer's full line count, useful for telling whether earlier output exists. `lines` is capped at 10000.

---

### POST /api/sessions/:pane_id/input

Inject input bytes into a specific pane.

**Request body:**

```json
{ "data": "ls -la\r" }
```

`data` is a string written to the PTY as UTF-8 bytes. Use `\r` for Enter, `` for Ctrl+C, `` for Ctrl+D.

**Response:**

- 200 `{"ok": true}`
- 404 - pane not found
- 500 - PTY write failed (session has exited)

> **Note**: This endpoint bypasses the [Mission Control safety net](./mission-control-api.md#input-safety-net-while-mc-is-open). Even when MC is open, input still reaches the PTY. If you need "user-perspective" semantics (drop input while MC is open), send `Input` over `/ws/sync` instead.

---

### POST /api/sessions/:pane_id/resize

Resize the pane (PTY cols × rows).

**Request body:**

```json
{ "cols": 120, "rows": 32 }
```

**Response:**

- 200 `{"ok": true}`
- 400 - `cols` or `rows` is 0
- 404 - pane not found
- 500 - PTY resize failed

Resize triggers TIOCSWINSZ; programs running inside the shell receive `SIGWINCH`.

---

### POST /api/input

Inject input into the active pane. Equivalent to `POST /api/sessions/:pane_id/input` but the caller doesn't have to track the active pane.

**Request body:**

```json
{
  "pane_id": "pane-1",
  "data": "echo hi\r"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `data` | yes | Bytes to inject |
| `pane_id` | no | Target pane; falls back to `active_pane_id` if omitted, then to the first session if active is empty |

**Response:**

- 200 `{"ok": true}`
- 400 - no session available
- 404 - specified `pane_id` does not exist

---

## Difference from Agent API

| Dimension | Open API | Agent API |
|-----------|----------|-----------|
| Command boundary detection | None; raw byte I/O only | Yes; OSC 133 shell integration + prompt detection |
| Synchronous execution | No; poll `screen` yourself | `POST /api/agent/run` waits for exit_code |
| Auth | Global token / session | Global token + Agent Token (capability-scoped) |
| Event subscription | None | `WS /ws/agent` pushes `command_finished` and other events |
| Enable condition | `open_api.enabled = true` | Also requires `open_api.enabled = true` |
| Best for | Custom terminal recording, bulk screen scraping | AI agents, CI pipelines, command-level automation |

In short: the Open API is "an HTTP tunnel for terminal byte streams"; the Agent API is "a command-level semantic layer". If you just want to push characters into a terminal and read the screen back, use the Open API. If you need to know "did that command finish, and what was the exit code", use the Agent API.

---

## Error Format

```json
{ "error": "pane not found" }
```

| HTTP | Meaning |
|------|---------|
| 400 | Invalid params (cols/rows=0, no active pane) |
| 401 | Unauthenticated |
| 403 | `open_api.enabled = false` |
| 404 | Pane not found |
| 500 | PTY write / resize failed |
