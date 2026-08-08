# Agent API

The Dinotty Agent API lets external programs (AI agents, automation scripts, CI/CD pipelines) interact with terminal sessions in a structured way over HTTP/WebSocket.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [HTTP Endpoints](#http-endpoints)
  - [POST /api/agent/run](#post-apiagentrun)
  - [POST /api/agent/send](#post-apiagentsend)
  - [GET /api/agent/read](#get-apiagentread)
- [WebSocket Endpoint](#websocket-endpoint)
- [Error Format](#error-format)
- [Concurrency Control](#concurrency-control)
- [Shell Integration](#shell-integration)
- [Required Capabilities](#required-capabilities)

---

## Overview

The Agent API offers three interaction modes:

| Mode | Endpoint | Description |
|------|----------|-------------|
| Synchronous run | `POST /api/agent/run` | Send a command, wait for completion, return exit_code + stdout |
| Async send | `POST /api/agent/send` | Send input without waiting (fire-and-forget) |
| Screen read | `GET /api/agent/read` | Read the current terminal screen |
| Long connection | `WS /ws/agent` | WebSocket: command execution + event subscription |

All endpoints require `open_api.enabled = true` (toggle in settings).

---

## Authentication

The Agent API supports two auth methods:

### Global Token

The global token configured at server startup; has all permissions.

```bash
curl -H "Authorization: Bearer <global-token>" \
     http://localhost:8999/api/agent/run \
     -d '{"command": "ls -la"}'
```

### Agent Token

Fine-grained token created via `/api/tokens`, supports capability scoping:

```bash
# Create a read-only token
curl -X POST -H "Authorization: Bearer <global-token>" \
     http://localhost:8999/api/tokens \
     -d '{
       "name": "monitoring-agent",
       "capabilities": ["terminal:read"],
       "expires_in": 86400
     }'
# Response: {"token": "dnt_...", "token_info": {...}}
```

Token format: `dnt_<64-char hex>`, stored as SHA-256 hashes.

---

## HTTP Endpoints

### POST /api/agent/run

Execute a command synchronously, waiting for completion or timeout.

**Request body:**

```json
{
  "command": "ls -la",
  "cwd": "/tmp",           // optional, working directory; Windows example: "C:\\Users\\dev\\project"
  "env": {"KEY": "val"},   // optional, environment variables (not yet implemented)
  "timeout": 30000,        // optional, timeout in ms (default 300000, max 3600000)
  "pane_id": "auto",       // optional, target pane (default "auto" uses the active pane)
  "strip_ansi": true       // optional, strip ANSI escape sequences (default true)
}
```

**Success response (200):**

```json
{
  "exit_code": 0,
  "stdout": "file1.txt\nfile2.txt\n",
  "stderr": "",
  "duration": 150,
  "pane_id": "pane-abc123",
  "method": "shell_integration"
}
```

**`method` field:**

| Value | Description |
|-------|-------------|
| `shell_integration` | Command completion detected via OSC 133 (most accurate) |
| `prompt_detection` | Detected via prompt pattern matching (fallback) |
| `timeout` | Command timed out |

### POST /api/agent/send

Send input to the terminal without waiting for a result.

**Request body:**

```json
{
  "command": "echo hello",
  "pane_id": "auto"
}
```

**Response (200):**

```json
{"ok": true, "pane_id": "pane-abc123"}
```

### GET /api/agent/read

Read the terminal screen contents.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `pane_id` | string | "active" | Target pane |
| `scrollback` | int | none | Return the last N lines of history (max 10000) |
| `strip_ansi` | bool | true | Strip ANSI escapes |

**Response (200):**

```json
{
  "pane_id": "pane-abc123",
  "lines": ["$ ls -la", "total 0", "drwxr-xr-x  ..."],
  "scrollback": ["previous command output..."],
  "cursor": {"row": 5, "col": 12},
  "cwd": "/Users/dev/project"
}
```

---

## WebSocket Endpoint

Connect: `ws://localhost:8999/ws/agent`

### Client messages

**Run a command:**

```json
{
  "type": "run",
  "id": "req-1",           // request ID, used to match responses
  "command": "npm test",
  "timeout": 60000
}
```

**Subscribe (all events are auto-subscribed on connect):**

```json
{"type": "subscribe"}
```

**Heartbeat:**

```json
{"type": "ping"}
```

### Server messages

**Command result:**

```json
{
  "type": "result",
  "id": "req-1",
  "exit_code": 0,
  "stdout": "All tests passed\n",
  "stderr": "",
  "duration": 3200,
  "pane_id": "pane-abc123",
  "method": "shell_integration"
}
```

**Event push:**

```json
{
  "type": "event",
  "event": {
    "event": "command_finished",
    "data": {
      "pane_id": "pane-abc123",
      "command": "",
      "exit_code": 0,
      "duration_ms": 150,
      "stdout": "",
      "method": "shell_integration"
    }
  }
}
```

**Error:**

```json
{
  "type": "error",
  "id": "req-1",
  "error": {"code": "NOT_FOUND", "message": "No active session"}
}
```

**Heartbeat response:**

```json
{"type": "pong"}
```

---

## Error Format

All errors return a unified shape:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

| HTTP | Code | Description |
|------|------|-------------|
| 400 | `INVALID_REQUEST` | Invalid request params |
| 403 | `CAPABILITY_DENIED` | Agent API disabled or token lacks capability |
| 404 | `NOT_FOUND` | No active session or pane not found |
| 429 | `RATE_LIMITED` | Concurrent request limit exceeded |
| 500 | `INTERNAL_ERROR` | Internal error |

---

## Concurrency Control

- Max **10** concurrent `run` requests per token
- Exceeding the limit returns `429 Too Many Requests` with a `Retry-After: 5` header
- `send` and `read` are not rate-limited

---

## Shell Integration

The Agent API prefers OSC 133 Shell Integration to detect command boundaries, falling back to prompt detection when the shell doesn't fully support it:

```
ESC ] 133 ; A ESC \    -> prompt start
ESC ] 133 ; B ESC \    -> command start (user pressed Enter)
ESC ] 133 ; D ; N ESC \ -> command finished, N is the exit code
```

Dinotty auto-injects / enables the integration based on the local shell:

- **zsh**: OSC 133 injected via `precmd_functions` and `preexec_functions`
- **bash**: OSC 133 injected via `PROMPT_COMMAND` and `BASH_ENV` trap
- **PowerShell / pwsh (Windows)**: a `prompt` function is injected at startup for window title, CWD, and prompt boundary sync; completion detection may still fall back to `prompt_detection`
- **cmd.exe / sh / other**: OSC 133 not guaranteed; auto-falls back to prompt detection

On Windows, the `command` field is sent to the current pane's actual shell; PowerShell can use `Get-ChildItem`, cmd can use `dir`. Windows paths in JSON strings need to be written as `C:\\Users\\dev\\project`.

---

## Required Capabilities

| Operation | Required Capability |
|-----------|---------------------|
| `POST /api/agent/run` | `terminal:write` |
| `POST /api/agent/send` | `terminal:write` |
| `GET /api/agent/read` | `terminal:read` |
| `WS /ws/agent` | `terminal:read` + `terminal:write` |
