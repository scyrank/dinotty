# Open API（终端会话读写）

Open API 是一组低层级 HTTP 接口，让外部程序直接读取终端屏幕、scrollback，向指定 Pane 写入输入，或调整 Pane 尺寸。它不创建或销毁 Tab / Pane，那是 [Tabs & Panes API](./tabs-panes-api.md) 的职责。

## 目录

- [概述](#概述)
- [启用开关](#启用开关)
- [认证](#认证)
- [接口列表](#接口列表)
  - [GET /api/sessions](#get-apisessions)
  - [GET /api/sessions/:pane_id/screen](#get-apisessionspane_idscreen)
  - [GET /api/sessions/:pane_id/scrollback](#get-apisessionspane_idscrollback)
  - [POST /api/sessions/:pane_id/input](#post-apisessionspane_idinput)
  - [POST /api/sessions/:pane_id/resize](#post-apisessionspane_idresize)
  - [POST /api/input](#post-apiinput)
- [与 Agent API 的区别](#与-agent-api-的区别)
- [错误格式](#错误格式)

---

## 概述

| 操作 | 端点 | 说明 |
|------|------|------|
| 列出会话 | `GET /api/sessions` | 所有 PTY 会话的元数据 + active_pane_id |
| 读屏幕 | `GET /api/sessions/:pane_id/screen` | 当前可见区域（plain / ansi） |
| 读 scrollback | `GET /api/sessions/:pane_id/scrollback` | 最近 N 行历史输出 |
| 写输入 | `POST /api/sessions/:pane_id/input` | 向指定 Pane 注入字节 |
| 调整尺寸 | `POST /api/sessions/:pane_id/resize` | 改 PTY cols/rows |
| 写入活跃 Pane | `POST /api/input` | 不指定 pane_id 时落到 active pane |

Open API 操作的是已经存在的 PTY 会话。要创建新会话，请用 [Tabs API](./tabs-panes-api.md)。

---

## 启用开关

Open API 默认关闭。在设置 `open_api.enabled = true` 后才会放行 `/api/sessions/*` 和 `/api/input`。

```bash
curl -X PUT -H "Authorization: Bearer <token>" \
     http://localhost:8999/api/settings \
     -d '{"open_api":{"enabled":true}, /* ...其他设置原样回传 */ }'
```

未启用时所有 Open API 端点返回：

```json
{ "error": "open_api is disabled" }
```

HTTP 状态码 403。

---

## 认证

Open API 走全局 auth middleware：

- **Session Cookie**：浏览器同源场景
- **Bearer Token**：`Authorization: Bearer <global-token>`

Open API **不支持** Agent Token（细粒度 token）。如果需要按权限粒度授权，请改用 [Agent API](./agent-api.md)，它支持 `terminal:read` / `terminal:write` capability。

---

## 接口列表

### GET /api/sessions

列出所有 PTY 会话。

**响应 (200)：**

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

`status` 取值：

- `connected` - PTY 活跃
- `detached` - PTY 已退出但布局未清理

`cwd` 是服务端通过 shell 集成（OSC 7 / 同步探测）得到的当前工作目录；SSH 会话或未支持集成的 shell 可能为 `null`。

---

### GET /api/sessions/:pane_id/screen

读取当前可见屏幕内容。

**查询参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `format` | string | `plain` | `plain` 去 ANSI 转义；`ansi` 保留颜色和光标序列 |

**响应 (200)：**

```json
{
  "pane_id": "pane-1",
  "content": "$ ls -la\ntotal 0\ndrwxr-xr-x  2 dev  staff   64 Aug  8 10:00 .\n",
  "size": { "cols": 120, "rows": 32 }
}
```

`content` 是按行拼接的字符串（`\n` 分隔）。`ansi` 模式适合录制 / 回放终端画面；`plain` 适合日志抓取与正则匹配。

---

### GET /api/sessions/:pane_id/scrollback

读取 scrollback 历史输出。

**查询参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `lines` | int | 200 (ansi 模式) / 全部 (plain) | 返回最近 N 行 |
| `format` | string | `plain` | `plain` / `ansi` |

**响应 (200)：**

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

`total` 是 scrollback 缓冲区的总行数，可用于判断是否还有更早的输出。`lines` 上限 10000。

---

### POST /api/sessions/:pane_id/input

向指定 Pane 注入输入字节。

**请求体：**

```json
{ "data": "ls -la\r" }
```

`data` 是字符串，会以 UTF-8 字节流写入 PTY。回车用 `\r`，Ctrl+C 用 ``，Ctrl+D 用 ``。

**响应：**

- 200 `{"ok": true}`
- 404 - Pane 不存在
- 500 - PTY 写入失败（会话已退出）

> **注意**：此接口绕过 [Mission Control 安全网](./mission-control-api.md#inputmc-开启时的安全网)。即使 MC 已开启，输入仍会进入 PTY。如果需要"用户视角"语义（MC 开启时丢弃输入），请通过 `/ws/sync` 发送 `Input` 消息。

---

### POST /api/sessions/:pane_id/resize

调整 Pane 尺寸（PTY cols × rows）。

**请求体：**

```json
{ "cols": 120, "rows": 32 }
```

**响应：**

- 200 `{"ok": true}`
- 400 - `cols` 或 `rows` 为 0
- 404 - Pane 不存在
- 500 - PTY resize 失败

resize 会触发 TIOCSWINSZ，shell 内运行的程序会收到 `SIGWINCH`。

---

### POST /api/input

向 active Pane 注入输入。等价于 `POST /api/sessions/:pane_id/input`，但无需调用方手动跟踪 active pane。

**请求体：**

```json
{
  "pane_id": "pane-1",
  "data": "echo hi\r"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `data` | 是 | 注入的字节序列 |
| `pane_id` | 否 | 目标 Pane；省略时落到 `active_pane_id`；若 active 为空则取 sessions 中第一个 |

**响应：**

- 200 `{"ok": true}`
- 400 - 没有任何可用会话
- 404 - 指定 `pane_id` 不存在

---

## 与 Agent API 的区别

| 维度 | Open API | Agent API |
|------|---------|-----------|
| 命令边界检测 | 无，只读写原始字节 | 有，OSC 133 shell 集成 + prompt 检测 |
| 同步执行 | 无，需自己轮询 `screen` | `POST /api/agent/run` 等待 exit_code |
| 认证 | 全局 token / session | 全局 token + Agent Token（细粒度 capability） |
| 事件订阅 | 无 | `WS /ws/agent` 推送 `command_finished` 等事件 |
| 启用条件 | `open_api.enabled = true` | 同样需要 `open_api.enabled = true` |
| 适合场景 | 自定义终端录制、批量抓取屏幕 | AI Agent、CI 流水线、命令级自动化 |

简单说：Open API 是"终端字节流的 HTTP 通道"，Agent API 是"命令级语义层"。如果只是想从外部把字符塞进终端并读回屏幕，用 Open API；如果想知道"刚才那条命令是否结束、exit code 是多少"，用 Agent API。

---

## 错误格式

```json
{ "error": "pane not found" }
```

| HTTP | 含义 |
|------|------|
| 400 | 参数无效（cols/rows=0、无 active pane） |
| 401 | 未认证 |
| 403 | `open_api.enabled = false` |
| 404 | Pane 不存在 |
| 500 | PTY 写入 / resize 失败 |
