# Can a Provider's tool call be held open while the user decides?

Research for issue #173 (parent map #170). Researched 2026-11-09.

## Question

A Message with no Messaging rule holds the call while Timmy asks the user. For Claude Code, Codex and OpenCode:

1. what is the tool-call timeout,
2. can it be raised or disabled,
3. does the agent show progress while it waits,
4. what does the agent see if Timmy answers late, or the call is cancelled?

The answer sets the limits of the approval prompt.

"The tool" here is a Timmy-hosted MCP tool (the Provider calls it, Timmy's MCP server holds the `tools/call` request open, Timmy asks the user, Timmy answers). All three Providers are MCP clients, so the generic MCP rules in the first section apply to all of them and each Provider's own behaviour sits on top.

## Short answer

Yes, a call can be held, but the hold is bounded and the bound is different per Provider. Timmy writes its own MCP entry into each Provider's config (ADR 0009), and all three let that entry carry its own timeout, so Timmy can raise the limit for its own tool only.

| | Claude Code | Codex | OpenCode v1 (`v1.19.5`, current "latest" release) | OpenCode v2 (`v2.2.x`) |
| --- | --- | --- | --- | --- |
| Default wall-clock limit on a tool call | About 28 hours (`MCP_TOOL_TIMEOUT` default 100000000 ms) | 300 s in source; the docs say 60 s (they disagree) | 60 s (MCP SDK default, no OpenCode override) | 12 hours |
| Raise or disable | Raise per server (`timeout` in the server entry) or globally (`MCP_TOOL_TIMEOUT`). No documented "off". | Raise per server (`tool_timeout_sec`). Cannot be turned off: source always passes a value. | Raise per server (`timeout`) or globally (`experimental.mcp_timeout`). | Raise per server or globally (`mcp.timeout.execution`). |
| Does a progress notification extend it? | No for the wall-clock limit. Yes for the separate idle timeout. | No. Progress is only logged. | Yes: each progress notification restarts the timer, with no total cap. | No: `execution` is a hard wall. |
| Other timers that can fire first | Idle timeout 5 min (HTTP/SSE/WebSocket) or 30 min (stdio), reset by progress. Per-request first-byte timer 60 s (HTTP/SSE only). Auto-move to background after 2 min (interactive, main conversation). | None found for `tools/call`. | None found. | None found. |
| Progress shown to the user while waiting | Not documented for a foreground call. The `/tasks` entry shows the latest progress after the call is backgrounded. | No. The TUI shows `Calling server.tool(...)` with a spinner. | Not shown: the progress handler is a no-op, it only requests a token. | Same: no-op handler. |
| On timeout the agent sees | Undocumented for a plain call. Documented text exists only for an unanswered elicitation. | A tool error `tool call error: ... timed out awaiting tools/call after <N>s` (read from source). | `MCP error -32001: Request timed out` (SDK error, thrown by the tool; the exact model-facing wrapping is not read). | Same SDK family; see the per-Provider section. |
| On cancel (user interrupts) | `Esc` stops the call. Whether Claude Code then sends `notifications/cancelled` is not documented. | Tool result `aborted by user after <N>s`; sends `notifications/cancelled`. | Aborts; the SDK sends `notifications/cancelled`; the tool part reads `Tool execution aborted`. | Same SDK cancel path. |

The constraint that matters most for the approval prompt is on Claude Code: in an interactive session a main-conversation MCP call still running after two minutes is moved to a background task and Claude "receives the task ID immediately and keeps working". The agent does not stay blocked on the prompt past two minutes; the answer arrives later as a task notification.

## Sources and how far they can be trusted

| Provider | Primary sources used | Source code available? |
| --- | --- | --- |
| MCP protocol | Specification revision 2025-11-25: Lifecycle (Timeouts), Cancellation, Progress. TypeScript SDK `modelcontextprotocol/typescript-sdk` at `v1.29.0` (`src/shared/protocol.ts`, `src/types.ts`). | Yes |
| Claude Code | Official docs on `code.claude.com/docs/en` (`mcp.md`, `env-vars.md`, `errors.md`, `hooks.md`, `interactive-mode.md`), fetched 2026-11-09 as the raw `.md` pages. | No. `anthropics/claude-code` holds issues and changelog, not the CLI source, so anything the docs do not say is marked unknown. |
| Codex | `openai/codex` source at `e54a5713caf3` (main, 2026-11-09): `codex-rs/codex-mcp`, `codex-rs/rmcp-client`, `codex-rs/config`, `codex-rs/core`, `codex-rs/tui`; plus the docs page `developers.openai.com/codex/mcp`. | Yes |
| OpenCode | `anomalyco/opencode` at tag `v1.19.5` (the release GitHub marks "latest", published 2026-10-28) and at `dev` `ed0171f` (the v2 line, `v2.2.6` released 2026-11-06). Docs: `packages/web/src/content/docs/mcp-servers.mdx` (v1) and `services/site/src/docs/content/mcp-servers.mdx` (v2). | Yes |

Third-party blogs were not used as evidence. Both OpenCode lines are cited because the repo ships v1 and v2 releases side by side and `releases/latest` still points at v1.

Versions move fast. Claude Code's docs name feature versions up to v2.1.310 (see the version gates below); Codex and OpenCode claims are true of the commits above only.

## MCP protocol baseline (all Providers)

- Timeouts are the sender's choice. The spec says implementations "SHOULD establish timeouts for all sent requests", and on expiry "the sender SHOULD issue a cancellation notification for that request and stop waiting for a response". It lets a client reset the clock on a progress notification, but says implementations "SHOULD always enforce a maximum timeout, regardless of progress notifications". [MCP Lifecycle, Timeouts](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#timeouts)
- Cancellation is a `notifications/cancelled` with the `requestId` and an optional `reason`. The receiver "SHOULD stop processing", "not send a response for the cancelled request", and MAY ignore it if processing has finished. The sender "SHOULD ignore any response to the request that arrives afterward". [MCP Cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)
- So a late answer from Timmy, after the client gave up, is by spec discarded by the client. It is never an error the agent sees later; the agent only sees the timeout or cancel outcome.
- Progress needs the client to send a `progressToken` in `_meta`; the server "MAY" then send `notifications/progress` with `progress`, optional `total` and optional `message`, and progress "MUST increase with each notification". [MCP Progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress)
- The TypeScript SDK (used by OpenCode v1) defaults to `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000`, only resets on progress when `resetTimeoutOnProgress` is set, supports an optional `maxTotalTimeout`, and on timeout or abort sends `notifications/cancelled` and rejects with `McpError(RequestTimeout, 'Request timed out')`, whose message is `MCP error -32001: Request timed out`. [`protocol.ts` L106](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/src/shared/protocol.ts#L106), [L120-L143](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/src/shared/protocol.ts#L120-L143), [L576-L590](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/src/shared/protocol.ts#L576-L590), [L1165-L1218](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/src/shared/protocol.ts#L1165-L1218), [`types.ts` L194 and L2313](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/src/types.ts#L194)

## Findings per Provider

### Claude Code

Sources: [MCP page, "Time limits on MCP tool calls"](https://code.claude.com/docs/en/mcp#time-limits-on-mcp-tool-calls) and following sections; [env-vars](https://code.claude.com/docs/en/env-vars); [errors](https://code.claude.com/docs/en/errors); [interactive mode](https://code.claude.com/docs/en/interactive-mode).

**Timeout, and whether it can be raised or disabled**

- Wall-clock limit: `MCP_TOOL_TIMEOUT`, "default: 100000000, about 28 hours". A per-server `timeout` field in the server's entry (milliseconds) overrides it for that server. The per-server value is "a hard wall-clock limit per tool call, and progress notifications from the server don't extend it". Per-server values below 1000 are ignored. [env-vars `MCP_TOOL_TIMEOUT`](https://code.claude.com/docs/en/env-vars), [mcp.md](https://code.claude.com/docs/en/mcp#time-limits-on-mcp-tool-calls)
- There is no documented way to turn the wall-clock limit off, only to set it very high. The default is already about 28 hours.
- Idle timeout: a call that "sends no response and no progress notification for the idle window aborts with an error". Defaults: 5 minutes for HTTP, SSE, WebSocket and claude.ai connector servers, 30 minutes for stdio. Set `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (ms) to change it, `0` to disable. Does not apply to IDE or SDK in-process servers. A per-server `timeout` of 1000 or more is also a floor for the idle window. The idle timeout needs v2.1.187 or later, and stdio servers were exempt before v2.1.203. [mcp.md](https://code.claude.com/docs/en/mcp#time-limits-on-mcp-tool-calls), [env-vars `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`](https://code.claude.com/docs/en/env-vars)
- HTTP, SSE and connector servers also have a per-request timer "through to the server's first response byte": the greatest of 60 seconds, the tool timeout that applies to the server, and `MCP_TIMEOUT`. The 28-hour default of an unset `MCP_TOOL_TIMEOUT` "doesn't enter that comparison". Stdio and WebSocket servers have no per-request timer. [mcp.md](https://code.claude.com/docs/en/mcp#time-limits-on-mcp-tool-calls)
- Automatic backgrounding: "An MCP tool call in the main conversation that is still running after two minutes moves to a background task instead of blocking the session. Claude receives the task ID immediately and keeps working, and the result arrives as a task notification when the call settles." The wall-clock and idle limits still apply while it runs in the background. `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` changes the threshold (default 120000), and `0` turns it off, which also makes Claude wait for the call (needs v2.1.212 or later). Calls from subagents, calls to IDE servers, and non-interactive runs (unless `CLAUDE_AUTO_BACKGROUND_TASKS=1`) never move to the background. [mcp.md](https://code.claude.com/docs/en/mcp#automatic-backgrounding-of-long-tool-calls), [env-vars `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`](https://code.claude.com/docs/en/env-vars)
- Timmy hosts Claude Code interactively in a PTY (ADR 0008), so the two-minute backgrounding applies. Raising it means setting an environment variable, for example in the `env` block of `settings.json`; the docs show exactly that. That edits a setting that also affects Claude Code outside Timmy, which ADR 0009 treats as a cost to keep small. [mcp.md "Make Claude wait"](https://code.claude.com/docs/en/mcp#make-claude-wait-for-the-result-of-an-mcp-task)

**Progress while waiting**

- Claude Code honours progress notifications for the idle timer only. The docs mention showing progress in one place: a backgrounded call's `/tasks` entry "shows the latest progress the server has reported". The docs do not say a foreground call shows progress, so that is unknown. [mcp.md](https://code.claude.com/docs/en/mcp#automatic-backgrounding-of-long-tool-calls)
- A call waiting on an open MCP elicitation dialog is not backgrounded while the dialog is open ("the server is blocked on your input, not slow"). That only covers elicitation shown in Claude Code's own UI, which is not where Timmy would ask. [mcp.md](https://code.claude.com/docs/en/mcp#automatic-backgrounding-of-long-tool-calls)

**What the agent sees**

- A backgrounded call: the agent gets the task ID at once and the result later as a task notification. So if the user answers after two minutes, the agent still receives the outcome, as long as the wall-clock and idle limits have not fired. This is the one case where a "late" answer is delivered rather than discarded. [mcp.md](https://code.claude.com/docs/en/mcp#automatic-backgrounding-of-long-tool-calls)
- Stopping a backgrounded call: "Claude Code cancels the call and tells Claude that no result is coming. Stopping doesn't guarantee the server stops". `Esc` does not stop a background task. [mcp.md](https://code.claude.com/docs/en/mcp#automatic-backgrounding-of-long-tool-calls)
- Plain timeout text is undocumented. The only documented timeout string is for an unanswered MCP elicitation in non-interactive mode: `MCP server "<name>" tool "<tool>" timed out after <N>s. The server asked the user a question, and no answer came before the time limit. Do not call this tool again in this turn. Tell the user that the server's question got no answer, and wait for their reply.` (the second sentence onward since v2.1.310). [errors.md](https://code.claude.com/docs/en/errors#mcp-tool-call-timed-out-with-the-servers-question-unanswered)
- A dropped HTTP connection gives the agent `MCP server "<name>" connection closed before the tool call was answered. The tool may have run: check whether it did before running it again.` Claude Code repeats the call once on its own only if the server marked the tool as safe to repeat. A Timmy tool that has a side effect (delivering a Message) must not be marked safe to repeat. [errors.md](https://code.claude.com/docs/en/errors#mcp-server-connection-closed-before-the-tool-call-was-answered), [mcp.md "Mark tools that are safe to call twice"](https://code.claude.com/docs/en/mcp#mark-tools-that-are-safe-to-call-twice)
- Interactive `Esc` "stop the current response or tool call mid-turn". The docs do not say whether a foreground MCP call then gets `notifications/cancelled`, so a Timmy server cannot rely on that notification arriving; the transport closing is the other signal. [interactive-mode](https://code.claude.com/docs/en/interactive-mode)

**Not the same thing: the hold in a Hook.** Claude Code's `PreToolUse` and `PermissionRequest` hooks can also block a call while a command decides, with a default timeout of 600 seconds for `command`, `http` and `mcp_tool` hooks. That is a different seam from a held MCP call and is not researched further here. [hooks.md `timeout`](https://code.claude.com/docs/en/hooks)

### Codex

Sources: `openai/codex` at [`e54a5713caf3`](https://github.com/openai/codex/tree/e54a5713caf331f42a6eef0166186df5f7563c29); docs [developers.openai.com/codex/mcp](https://developers.openai.com/codex/mcp).

**Timeout, and whether it can be raised or disabled**

- Per-server config key `tool_timeout_sec` ("Default timeout for MCP tool calls initiated via this server"), a number of seconds, floats allowed. [`mcp_types.rs` L283-L285](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/config/src/mcp_types.rs#L283-L285), [`option_duration_secs`](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/config/src/mcp_types.rs#L692-L716)
- Default in source: `DEFAULT_TOOL_TIMEOUT = Duration::from_secs(300)`. The docs page says "`tool_timeout_sec` (optional): Timeout (seconds) for the server to run a tool. Default: 60." The two disagree; the source at current main is the more recent, but this needs an empirical check before Timmy relies on either number. [`rmcp_client.rs` L122-L123](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/codex-mcp/src/rmcp_client.rs#L122-L123), [docs](https://developers.openai.com/codex/mcp)
- It cannot be disabled: the connection manager always builds `Some(tool_timeout_sec.unwrap_or(DEFAULT_TOOL_TIMEOUT))` and a per-call requested timeout can only lower it (`min` of server and requested). A very large `tool_timeout_sec` is the only way to approximate "off". [`connection_manager.rs` L526-L529, L1400-L1404](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/codex-mcp/src/connection_manager.rs#L526-L529)
- The timeout excludes time spent in an MCP elicitation: `active_time_timeout` pauses its countdown while an `ElicitationPauseGuard` is held, and a test asserts it ("active_time_timeout_pauses_while_elicitation_is_pending"). That only helps if Timmy asks through MCP elicitation, which shows in Codex's own UI, not Timmy's. [`rmcp_client.rs` L211-L292, L2106-L2121](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/rmcp-client/src/rmcp_client.rs#L211-L292), [`elicitation_client_service.rs` L183](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/rmcp-client/src/elicitation_client_service.rs#L183)
- No other timer on `tools/call` was found. The only HTTP response-header timeout in the adapter (30 s) is gated on the `events/stream` method. [`http_client_adapter.rs` L70, L201, L255-L262](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/rmcp-client/src/http_client_adapter.rs#L201)

**Progress while waiting**

- Server progress notifications are received and only logged (`info!`). They do not reset the timeout and nothing is shown. [`logging_client_handler.rs` L63-L72](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/rmcp-client/src/logging_client_handler.rs#L63-L72)
- The TUI renders a running MCP call as `Calling <server>.<tool>(args)` with an activity indicator that animates from the call's start time, switching to `Called` when it ends. No progress text. [`history_cell/mcp.rs` L151-L168](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/tui/src/history_cell/mcp.rs#L151-L168)

**What the agent sees**

- On timeout the call fails with `ClientOperationError::Timeout`, displayed as `timed out awaiting tools/call after <N>s`, and core turns any call error into the tool result string `tool call error: {error:?}`. So the model sees a failed tool result naming the timeout. [`rmcp_client.rs` L300-L302](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/rmcp-client/src/rmcp_client.rs#L300-L302), [L1862-L1870](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/rmcp-client/src/rmcp_client.rs#L1862-L1870), [`mcp_tool_call.rs` L677](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/core/src/mcp_tool_call.rs#L677) The exact wording of the full `{error:?}` chain was read from code, not observed.
- On timeout the in-flight future is dropped, and a dropped `tools/call` sends `notifications/cancelled` with reason `MCP request cancelled by caller` (the call uses `RequestCancellation::OnDrop`). So a Timmy MCP server can detect both timeout and interrupt through that notification. [`request_cancellation.rs` L88-L125](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/rmcp-client/src/request_cancellation.rs#L88-L125), [`rmcp_client.rs` L1133](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/rmcp-client/src/rmcp_client.rs#L1133)
- On user interrupt the tool result is `aborted by user after <N>s`, and the next turn gets a `<turn_aborted>` note: "The user interrupted the previous turn on purpose ... If any tools/commands were aborted, they may have partially executed." [`parallel.rs` L498-L506](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/core/src/tools/parallel.rs#L498-L506), [`turn_aborted.rs` L11](https://github.com/openai/codex/blob/e54a5713caf331f42a6eef0166186df5f7563c29/codex-rs/core/src/context/turn_aborted.rs#L11)
- A late answer after cancel or timeout is dropped by the client, per the protocol baseline. No code path was found that delivers it to the agent later.

### OpenCode

OpenCode ships two lines. `v1.19.5` is GitHub's "latest" release and `v2.2.6` is newer by version number, so both are covered.

#### v1 (`v1.19.5`)

Sources: tag `v1.19.5` of `anomalyco/opencode`, with `@modelcontextprotocol/sdk` 1.29.0 (from `package.json`; the repo's `patches/@modelcontextprotocol%2Fsdk@1.29.0.patch` changes connect, session expiry and typings, not request timeouts).

**Timeout, and whether it can be raised or disabled**

- A tool call runs `client.callTool(..., { resetTimeoutOnProgress: true, signal: options.abortSignal, timeout, onprogress: () => {} })`. `timeout` is the per-server `timeout` from the config, else `experimental.mcp_timeout`, else `undefined`, which the SDK turns into 60 seconds. [`mcp/catalog.ts` L42-L66](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/mcp/catalog.ts#L42-L66), [`mcp/index.ts` L661-L685](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/mcp/index.ts#L661-L685), [`session/tools.ts` L391](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/session/tools.ts#L391), SDK default above
- Raise per server with `timeout` (milliseconds) in the server entry, or for all servers with `experimental.mcp_timeout` ("Timeout in milliseconds for model context protocol (MCP) requests"). No "disable". [`config/mcp.ts` L20-L22](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/core/src/v1/config/mcp.ts#L20-L22), [`config/config.ts` L182-L184](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/core/src/v1/config/config.ts#L182-L184)
- The documentation is misleading: the schema says "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds)" and the docs table says "for fetching tools". The code applies it to tool calls too and the real call default is the SDK's 60 s, not 5 s. The same value also sets the connect timeout (`mcp.timeout ?? 30_000`), so raising it for Timmy's entry also lengthens that server's connect timeout. [`docs mcp-servers.mdx` L126](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/web/src/content/docs/mcp-servers.mdx#L126), [`mcp/index.ts` L286](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/mcp/index.ts#L286)

**Progress while waiting**

- `resetTimeoutOnProgress: true` plus a no-op `onprogress` (the code comment: the SDK only sends a progress token when this hook is present) means each progress notification the server sends restarts the full `timeout` window. No `maxTotalTimeout` is set, so a server that sends progress more often than the timeout can hold the call indefinitely. Nothing is rendered for the progress itself. [`catalog.ts` L54-L66](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/mcp/catalog.ts#L54-L66), [SDK `protocol.ts` L576-L590](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/src/shared/protocol.ts#L576-L590)
- MCP elicitation is not supported in v1: the capability is commented out in the client (`// elicitation: {}`). [`mcp/index.ts` L44](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/mcp/index.ts#L44)

**What the agent sees**

- Timeout: the SDK sends `notifications/cancelled`, then rejects with `MCP error -32001: Request timed out`. The tool wrapper lets that exception propagate, so the model-facing text is a tool error carrying that message (the AI SDK step that formats it was not read). [SDK `protocol.ts` L1165-L1218](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/src/shared/protocol.ts#L1165-L1218)
- User abort: `options.abortSignal` is passed to the SDK, which sends `notifications/cancelled` with the abort reason. The processor then marks every unfinished tool part `status: "error"`, `error: "Tool execution aborted"`, `interrupted: true`. [`session/processor.ts` L585-L605](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/session/processor.ts#L585-L605)
- OpenCode asks its own permission (`ctx.ask`) before running an MCP tool; that prompt is separate from the held call and happens before it starts. [`session/tools.ts` L408](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/session/tools.ts#L408)

#### v2 (`dev` at `ed0171f`; `v2.2.6` released 2026-11-06)

Sources: `packages/core/src/mcp/client.ts`, `packages/schema/src/mcp.ts` and the docs `services/site/src/docs/content/mcp-servers.mdx`, at [`ed0171f`](https://github.com/anomalyco/opencode/tree/ed0171f08ac4018ae648fcca7315b3d717989d50).

- Timeouts are documented: `startup` 30 s, `catalog` 30 s, `execution` 12 hours ("Tool calls, prompt retrieval, and resource reads"). They are positive integer milliseconds, set under `mcp.timeout` for all servers or in a server's own `timeout` object. No "disable". [docs "Timeouts"](https://github.com/anomalyco/opencode/blob/ed0171f08ac4018ae648fcca7315b3d717989d50/services/site/src/docs/content/mcp-servers.mdx#L303-L333), [`client.ts` L35-L38](https://github.com/anomalyco/opencode/blob/ed0171f08ac4018ae648fcca7315b3d717989d50/packages/core/src/mcp/client.ts#L35-L38), [`schema/src/mcp.ts` L7-L16](https://github.com/anomalyco/opencode/blob/ed0171f08ac4018ae648fcca7315b3d717989d50/packages/schema/src/mcp.ts#L7-L16)
- Progress does not extend it. The code comment: "The SDK timeout does not reset on progress; execution is the hard wall." It passes `onprogress: () => {}` only to get a progress token, because progress on the response stream "can keep proxies from closing it". [`client.ts` L508-L526](https://github.com/anomalyco/opencode/blob/ed0171f08ac4018ae648fcca7315b3d717989d50/packages/core/src/mcp/client.ts#L508-L526)
- Cancel goes through the SDK `signal`, same cancel path as v1. [`client.ts` L510-L518](https://github.com/anomalyco/opencode/blob/ed0171f08ac4018ae648fcca7315b3d717989d50/packages/core/src/mcp/client.ts#L510-L518) The v2 text the model sees on timeout or cancel was not read.
- v2 supports MCP elicitation: the docs say the request shows "as a form, or as a link", and "Dismissing the form cancels the request". Whether the execution timeout pauses while that form is open was not checked. [docs "Input requests"](https://github.com/anomalyco/opencode/blob/ed0171f08ac4018ae648fcca7315b3d717989d50/services/site/src/docs/content/mcp-servers.mdx#L486-L492)
- v2 sends the session id in `_meta["ai.opencode/sessionID"]` for session calls. [docs "Context"](https://github.com/anomalyco/opencode/blob/ed0171f08ac4018ae648fcca7315b3d717989d50/services/site/src/docs/content/mcp-servers.mdx#L496-L510)

## What this means for the approval prompt

These follow from the findings above; they are not decisions.

1. **One number does not fit all Providers, but Timmy controls it per entry.** Each Provider's own timeout setting lives on the server entry Timmy already writes (Claude Code `timeout` in ms, Codex `tool_timeout_sec` in s, OpenCode v1 `timeout` in ms, OpenCode v2 `timeout.execution` in ms). Raising it there touches only Timmy's own entry, which fits ADR 0009. Side effects: OpenCode v1's `timeout` also sets that server's connect timeout; Claude Code's per-server `timeout` is a hard wall that progress does not extend and also floors that server's idle window.
2. **The unconfigured hold is short on two of three Providers.** Codex is 300 s in source (60 s per its docs) and OpenCode v1 is 60 s, extendable by progress. Claude Code and OpenCode v2 default to hours, but Claude Code backgrounds the call after 2 minutes.
3. **Progress notifications are not a universal keepalive.** They keep the call alive on OpenCode v1 and (for the idle timer only) Claude Code, and do nothing on Codex and OpenCode v2. The first-byte timer on Claude Code HTTP servers (60 s) means an HTTP Timmy server must send headers or a first event inside that window.
4. **The agent will not show the prompt's progress.** No Provider shows server progress for a foreground call. The only visible state is each Provider's own "calling a tool" indicator. The approval UI has to live in Timmy.
5. **Claude Code does not stay blocked past two minutes by default.** After that the agent keeps working and gets the outcome as a task notification when Timmy answers. This is good for a slow user, but the agent may continue with the Message unconfirmed in its context. For MCP tasks the docs add "If Claude is idle when the result arrives, Claude starts on it unprompted"; whether the same holds for an auto-backgrounded plain call is not stated. Whether that is acceptable, or whether Timmy should set `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0`, is a design question for the map.
6. **A late answer is not delivered anywhere, except Claude Code's backgrounded case.** After a timeout or cancel, the Provider's client discards any response (protocol baseline; Codex and OpenCode send `notifications/cancelled` first). If Timmy treats "no answer in time" as refused, the user's later click should be refused or ignored, not delivered, and Timmy should retract the pending prompt when it sees the cancel notification or the connection closing.
7. **Cancel signals differ.** Codex and OpenCode send `notifications/cancelled` on both timeout and user interrupt (from source). Claude Code documents cancelling only for backgrounded calls and MCP tasks (`tasks/cancel`), not for a foreground call, so a Timmy server should also treat a closed request or connection as a cancel.
8. **A side-effecting tool must not be marked safe to repeat** in Claude Code, or a dropped connection could deliver a Message twice after the user approved it once. [mcp.md](https://code.claude.com/docs/en/mcp#mark-tools-that-are-safe-to-call-twice)
9. **Elicitation is not a way out.** Using MCP elicitation would move the question into the Provider's own UI (Claude Code's dialog, Codex's approval view, OpenCode v2's form), and v1 OpenCode does not support it. It would also remove Timmy's approval prompt from the loop. Codex's timeout excludes elicitation time; Claude Code defers backgrounding while its dialog is open; but neither helps when the prompt is Timmy's.

## Unknowns

- Claude Code: what the agent sees when a plain (non-elicitation) MCP call hits the wall-clock or idle timeout. Whether a foreground call shows server progress. Whether `Esc` on a foreground call sends `notifications/cancelled`. No CLI source is available, so these need an empirical run or an upstream answer.
- Codex: the real default (60 s in the docs, 300 s in source). The exact model-facing text of `{error:?}`.
- OpenCode: whether v2's execution timeout pauses while an elicitation form is open; the exact text the model sees on timeout or abort in both lines.
- All three: behaviour with a Timmy-hosted server over each transport (stdio versus Streamable HTTP), since Claude Code's per-request timer and idle defaults differ by transport.
