# Can a Timmy-hosted tool server tell which Terminal is calling?

Research for issue #172 (parent map #170). Researched 2026-11-09.

## Question

Timmy sets `TIMMY_TERMINAL_ID` in every Terminal's environment (`src/shared/hooks/hooks.model.ts`, `electron/terminal/terminal-service.ts`). For Claude Code, Codex and OpenCode:

1. How can a tool server learn which Terminal a call comes from, and trust it: a per-Terminal URL with a token (like the Hook channel's `/hook/<token>/<terminalId>`), a header filled from the environment, or something else?
2. Can the Provider interpolate an environment variable into the registered server's URL or headers?
3. Can one Terminal forge another's identity?

## Short answer

- **Yes, a tool server can tell, as long as the identity travels with the Provider process and not with the config file.** A Provider's config is one shared file; the Terminal's environment is the only per-Terminal input. All three Providers can turn an environment variable into something the server sees, but each by a different mechanism (table below).
- **Only Claude Code and OpenCode can put an environment variable in the URL.** Codex cannot (no interpolation in `url`); it can put one in a header (`env_http_headers`) or forward it to a stdio server (`env_vars`).
- **The Hook channel's scheme is forgeable as it stands.** Its secret is one token for the whole run, handed to every Terminal; identity is just the `terminalId` path segment. Terminal A can post as Terminal B if it knows B's id, and the planned "list every live Terminal" tool hands out exactly those ids. A tool that sends Messages needs a secret **per Terminal**, not per run.
- **Something that works for all three Providers is a stdio bridge**: a tiny stdio MCP server the Provider spawns, which reads `TIMMY_TERMINAL_ID` and a per-Terminal secret from its inherited environment and relays to main. It costs a shipped executable. The alternative is Claude Code and OpenCode over HTTP with the URL from the environment, and Codex over a header or a bridge.

## Sources and how far they can be trusted

| Provider | Primary sources used | Source code available? |
| --- | --- | --- |
| Claude Code | Official docs on `code.claude.com/docs`: `mcp`, `hooks`, `env-vars` | No. Behaviour the docs do not state is marked **unknown**. Nothing was run. |
| Codex | `openai/codex` source at `e54a571` (main, 2026-11-09): `codex-rs/config/src/mcp_types.rs`, `codex-rs/rmcp-client/src/utils.rs`, `codex-rs/rmcp-client/src/http_headers.rs`; the MCP doc on `learn.chatgpt.com/docs/extend/mcp` (the former `developers.openai.com/codex/mcp` redirects there) | Yes |
| OpenCode | `anomalyco/opencode` (the former `sst/opencode`) source at `ed0171f` (dev, 2026-11-09): `packages/core/src/config/variable.ts`, `packages/core/src/mcp/stdio.ts`, `packages/core/src/mcp/client.ts`; docs `packages/web/src/content/docs/{mcp-servers,config,plugins}.mdx` | Yes |
| Timmy | This repo at `ef92a47`: `electron/hooks/hook-channel.ts`, `electron/terminal/terminal-service.ts`, `src/shared/hooks/hooks.model.ts`, ADR 0009 | Yes |

No third-party write-ups were used. Versions move fast; each claim is true of the versions above. Nothing in this note was verified by running a Provider.

## How the Hook channel identifies a Terminal today

- `layerHookChannel` creates **one** `crypto.randomUUID()` token when it starts, and listens on `127.0.0.1` on a random port (`listen(0, '127.0.0.1')`). `urlFor(terminalId)` returns `http://127.0.0.1:<port>/hook/<token>/<terminalId>`. The handler accepts a POST when the path token equals that token and the id decodes as a `TerminalId` (`electron/hooks/hook-channel.ts`).
- `TerminalService.create` spawns every Terminal with `TIMMY_TERMINAL_ID=<id>` and `TIMMY_HOOK_URL=urlFor(id)` (`electron/terminal/terminal-service.ts`). The id is `crypto.randomUUID()` unless a caller passes one (restored Terminals keep their id across restarts, ADR 0011).
- Consequences: the token authenticates "a process Timmy gave the URL to", not "Terminal X". The port and token change every run, so neither can be written into a Provider's persistent config; they must reach the Provider through the environment, as the Hooks do (ADR 0009).

## Findings per Provider

### Claude Code

**Environment interpolation.** Yes, in the URL and headers. The docs: "You can reference an environment variable in a server's `command`, `args`, `env`, `url`, or `headers` value, in either of two forms: `${VAR}` ... `${VAR:-default}`", with the example `"url": "${API_BASE_URL:-https://api.example.com}/mcp"` and `"Authorization": "Bearer ${API_KEY}"` ([mcp, "Environment variable expansion in `.mcp.json`"](https://code.claude.com/docs/en/mcp)). The docs show it under `.mcp.json`; they do not say whether the same expansion applies to entries in `~/.claude.json` (user or local scope). The page does mention `${VAR}` expansion for "a local- or user-scoped server entry in `~/.claude.json`" in the `CLAUDE_PROJECT_DIR` note, which implies it does, but that is an inference. **Timing of expansion (config load, connect, reconnect) is not stated.**

**Unset variable.** "the config still loads: Claude Code reports a missing-variable warning for that server in `claude mcp list` output and uses the unexpanded `${VAR}` text as-is" (same section). So a persistent entry whose URL is `${TIMMY_MCP_URL}` shows a warning and a failed server in a Claude Code run outside Timmy. That is not "inert outside Timmy" (ADR 0009). With `${VAR:-default}` the config loads silently but still points somewhere dead. A set-but-empty variable counts as set, so the default is not used.

**Names that expand as empty.** "In a remote server's `url` and `headers`, Claude Code reads credential variables from your environment as empty rather than expanding them." The covered names are "Claude Code's own credentials, such as `ANTHROPIC_API_KEY`", "cloud provider's credentials, such as `AWS_BEARER_TOKEN_BEDROCK`" and "other credentials ... such as `HTTPS_PROXY` and `NPM_TOKEN`"; "A name outside this set, such as `API_KEY`, expands as written" ([mcp, "Credential variables that read as empty"](https://code.claude.com/docs/en/mcp)). The page gives categories and examples, **not the full list or a name pattern**. A separate section says `headersHelper` runs without every variable "whose name looks like a credential, such as a name with `TOKEN`, `SECRET`, `PASSWORD`, `KEY`, or `AUTH` in it" (same page, "Which variables a helper can read"), but that is for the helper, and only for servers from a project `.mcp.json` or a plugin; user and local scope are "Not removed". Do not name the carrier variable with those words, and test the chosen name; this is **unverified**.

**Headers.** `http`, `sse` and `ws` servers take `headers` (`claude mcp add --transport http ... --header "Authorization: Bearer ..."`) and a `headersHelper` command that "runs ... when connecting" and gets `CLAUDE_CODE_MCP_SERVER_NAME` and `CLAUDE_CODE_MCP_SERVER_URL` in its environment (same page). A `headers.Authorization` that the server rejects "reports the connection as failed instead of falling back to OAuth".

**Stdio servers inherit the shell environment by default.** `CLAUDE_CODE_MCP_ALLOWLIST_ENV`: "Set to `1` to spawn stdio MCP servers with only a safe baseline environment plus the server's configured `env`, instead of inheriting your shell environment" ([env-vars](https://code.claude.com/docs/en/env-vars)). So by default a stdio server sees `TIMMY_TERMINAL_ID`. That opt-in switch and `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` ("strip credentials from the environments of the subprocesses Claude Code starts, such as Bash commands, hooks, and stdio MCP servers ... recognizes a credential by its variable name or its value", same page) can change this on a user's machine; a bridge must fail closed when the variables are missing. The docs also say hook commands inherit Claude Code's environment ([hooks](https://code.claude.com/docs/en/hooks)), which is how the existing Hook gets `TIMMY_TERMINAL_ID`.

**Where it is registered.** Scopes: local and user are stored in `~/.claude.json`, project in `.mcp.json`; `claude mcp add --scope user`, `claude mcp remove <name> --scope <scope>`, `claude mcp add-json` ([mcp, "Scopes and storage"](https://code.claude.com/docs/en/mcp)). `~/.claude.json` is a file Timmy does not own, so ADR 0009's rule (touch only Timmy's entries) applies; a reserved server name is the natural marker.

**Something else: the Hook channel can see the call.** MCP tools "appear as regular tools in tool events (`PreToolUse`, `PostToolUse`...)" as `mcp__<server>__<tool>`, and the hook input carries `session_id`, `tool_name`, `tool_input` and `tool_use_id` ([hooks](https://code.claude.com/docs/en/hooks)). Timmy's Hook already knows the Terminal from the environment, so it could report "Terminal X is calling `mcp__timmy__send`". Matching that report to the tool server's request is a correlation by timing and arguments, not an identity; **do not use it as the primary mechanism**. Whether the MCP request itself carries the Claude session id is **not stated**.

### Codex

**Environment interpolation.** Not in the URL. `mcp_servers.<name>` takes, for streamable HTTP: `url` ("The server address"), `bearer_token_env_var` ("Environment variable name for a bearer token to send in `Authorization`"), `http_headers` ("Map of header names to static values"), `env_http_headers` ("Map of header names to environment variable names (values pulled from the environment)"), and `http_headers_helper` ("Local command that prints a JSON object of header names and string values") ([MCP doc](https://learn.chatgpt.com/docs/extend/mcp?surface=cli); fields in `codex-rs/config/src/mcp_types.rs`, `RawMcpServerConfig`). The docs say nothing about `${VAR}` in `url`, and I found no expansion in the config types; **confidence: medium** (absence found by reading, not by a proven full-repo search; a GitHub code search for "interpolat" was rate-limited and not completed).

**Header from the environment: yes.** `build_default_headers` reads each `env_http_headers` entry with `env::var(&env_var)` from Codex's own process environment, skips it when empty or unset, and sends the rest (`codex-rs/rmcp-client/src/utils.rs`). So `env_http_headers = { "X-Timmy-Terminal" = "TIMMY_TERMINAL_ID" }` yields one header value per Terminal from one shared config. An unset variable means the header is simply absent, so the server must reject a request without it. A header's value can be any string, including a per-Terminal secret.

**The port problem.** `url` is static and Timmy's channel listens on a random port per run, so an HTTP registration for Codex needs either a fixed or remembered port or a bridge. The header carries the Terminal, but not where to connect.

**Stdio servers do not inherit.** `create_env_for_mcp_server` builds the environment from `DEFAULT_ENV_VARS` (on Unix `HOME, LOGNAME, PATH, SHELL, USER, __CF_USER_TEXT_ENCODING, LANG, LC_ALL, TERM, TMPDIR, TZ`; on Windows `WINDOWS_CORE_ENV_VARS`), plus names listed in `env_vars`, plus the config's `env` (`rmcp-client/src/utils.rs`). Docs: `env_vars` "Environment variables to allow and forward". So a bridge works only if the registration lists `env_vars = ["TIMMY_TERMINAL_ID", ...]`; `TIMMY_*` is not forwarded otherwise.

**`http_headers_helper` cannot see the Terminal.** The helper is spawned with `create_env_for_mcp_server(None, &[])` (`rmcp-client/src/http_headers.rs`), i.e. only the default variables, so it cannot read `TIMMY_TERMINAL_ID`. Only local servers support it (`mcp_types.rs`).

**Where it is registered.** `config.toml` (default `~/.codex/config.toml`), or `.codex/config.toml` "for trusted projects only"; `codex mcp add <name> --env K=V -- <command>` or `--url <url>` (MCP doc). Timmy does not own the file.

### OpenCode

**Environment interpolation.** Yes, anywhere in the config. `ConfigVariable.substitute` ("Apply {env:VAR} and {file:path} substitutions to config text") replaces `\{env:([^}]+)\}` in the **raw text** of the config with `process.env[name]`, or `""` if unset, before it is parsed (`packages/core/src/config/variable.ts`). Because it works on text, it applies to `url`, `headers`, `command` and `environment` alike. The docs confirm only part of it: "Use `{env:VARIABLE_NAME}` to substitute environment variables. ... If the variable is unset, it will be replaced with an empty string", with examples in `model` and `provider.<name>.options.apiKey`; the MCP page shows `"Authorization": "Bearer {env:MY_API_KEY}"` in `headers` but never states the syntax, and does not mention `url` ([config.mdx](https://github.com/anomalyco/opencode/blob/ed0171f08ac4018ae648fcca7315b3d717989d50/packages/web/src/content/docs/config.mdx), [mcp-servers.mdx](https://github.com/anomalyco/opencode/blob/ed0171f08ac4018ae648fcca7315b3d717989d50/packages/web/src/content/docs/mcp-servers.mdx)). The code is the evidence for `url`. The environment used is the OpenCode process's, which is the Terminal's.

**Remote servers.** The streamable HTTP client is built from `new URL(config.url)` with `requestInit: { headers: config.headers }` (`packages/core/src/mcp/client.ts`, lines about 345 to 350). Docs: remote fields are `url`, `headers`, `oauth`, `enabled`, `timeout`.

**Stdio servers inherit.** The spawn passes `env: options.environment` with `extendEnv: true`; the comment says the host environment is merged in (`packages/core/src/mcp/stdio.ts`), "what the MCP SDK's transport did". So a bridge sees `TIMMY_TERMINAL_ID`.

**Where it is registered.** Config is merged, not replaced: global `~/.config/opencode/opencode.json`, a custom file via `OPENCODE_CONFIG`, project `opencode.json`, inline `OPENCODE_CONFIG_CONTENT` (config.mdx). Timmy already installs an OpenCode plugin as the Hook (ADR 0009).

**Something else: a plugin tool.** Plugins in `~/.config/opencode/plugins/` can define a tool with the `tool` helper (`description`, `args`, `execute(args, context)`; context shows `directory` and `worktree`) (plugins.mdx). A plugin runs in OpenCode's process and could read `process.env.TIMMY_TERMINAL_ID` itself. The docs do not say the plugin runs in the same process, so **this is unverified**, and it applies to OpenCode only.

## Comparison

| | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- |
| Env var in the URL | Yes, `${VAR}` (documented for `.mcp.json`; user scope implied) | No (static `url`) | Yes, `{env:VAR}` on config text (source) |
| Env var in a header | Yes, `headers` with `${VAR}` | Yes, `env_http_headers` (source) | Yes, `headers` with `{env:VAR}` |
| Stdio server sees `TIMMY_TERMINAL_ID` | Yes by default; opt-in allowlist and scrub can remove it | Only if listed in `env_vars` | Yes (`extendEnv: true`) |
| Unset variable outside Timmy | Warning, literal `${VAR}` kept, connection fails | Header omitted, server connects, no identity | Empty string, URL likely invalid (**unknown**) |
| Config file | `~/.claude.json` (user scope) | `~/.codex/config.toml` | `~/.config/opencode/opencode.json` |

## Can one Terminal forge another's identity?

Reasoning from the code above, not from a Provider source:

1. **With the current Hook-channel scheme, yes.** Every Terminal's `TIMMY_HOOK_URL` contains the same run token. Anything running in Terminal A, including the agent's own shell tool (a Provider's tool subprocess inherits the environment; Claude Code docs say hooks do, and the env scrub is opt-in), can read it and POST to `/hook/<token>/<B's id>`. The only missing input is B's id, which is a random UUID but which the planned list-every-Terminal tool returns by design.
2. **A secret per Terminal closes that.** Main mints a random secret at spawn (not derived from the id), keeps `secret -> terminalId` in memory, and the server resolves the caller from the secret alone; the id in the path or header becomes a hint that is checked, not trusted. The secret has to be fresh per spawn (ids persist across restarts, ADR 0011, so an id is not a credential).
3. **What it does not close.** A process of the same OS user can generally read another process's environment (on Linux, `/proc/<pid>/environ` is governed by "a ptrace access mode PTRACE_MODE_READ_FSCREDS check", [proc_pid_environ(5)](https://man7.org/linux/man-pages/man5/proc_pid_environ.5.html); Windows was **not researched**). A prompt-injected agent in A that knows B's process can try. This is the same trust level as the OS user, so the boundary to state in the spec is "an agent cannot act as another Terminal through the tool", not "a hostile local process cannot".
4. **Fail closed.** Every Provider can send no identity (unset variable, scrub, allowlist). The server must refuse a call with a missing or unknown secret rather than treat it as "unknown Terminal".
5. **Do not let the agent supply it.** If the identity were a tool argument, the model could write any id. It has to come from the transport (URL, header, or bridge), which the model does not control.
6. **Secret visibility.** The secret sits in the Terminal's environment, so the agent can print it and could be talked into pasting it into a Message or log. It authorises only "send as this Terminal", which the agent can do anyway; keep it out of anything Timmy shows.

## Options for the spec

| Option | Works for | Cost |
| --- | --- | --- |
| **A. HTTP, URL from the environment** (`url = ${TIMMY_MCP_URL}`, secret in the path like the Hook channel) | Claude Code, OpenCode. Not Codex | Persistent Claude entry shows a failed server outside Timmy. |
| **B. HTTP, identity in a header from the environment** (`X-Timmy-Terminal` and a secret) | All three (Codex via `env_http_headers`) | Codex still needs a known address, so a fixed or remembered port. Claude `${VAR}` name filter must be tested. |
| **C. Stdio bridge** | All three (Codex needs `env_vars`) | A shipped executable per platform, one process per agent, and it must fail closed when the environment is stripped. The Provider spawns it, so identity does not cross a network hop. |
| **D. Hook correlation** | Claude Code only | Not an identity. Fallback for audit, not for trust. |
| **E. Plugin tool** | OpenCode only | Unverified process model. |

Whichever carries the identity, the server-side rule is the same: resolve the Terminal from a per-Terminal secret minted at spawn, never from a value the agent writes.

## Unknowns

- Claude Code: when `${VAR}` is expanded (load, connect, reconnect); whether user-scope entries expand; the full list of names read as empty in `url` and `headers`; whether `${TIMMY_*}` names are affected. Test by registering a server and reading what the server receives.
- Claude Code: whether the MCP request carries anything that identifies the session or the process.
- Codex: whether `url` is expanded anywhere (not found); whether an HTTP server survives a missing `env_http_headers` variable (code says the header is dropped).
- OpenCode: the behaviour of an empty `url` after substitution; whether plugins run in the OpenCode process.
- Windows: environment readability between same-user processes; how each Provider spawns a stdio server there (Codex uses `WINDOWS_CORE_ENV_VARS`, contents not read).
