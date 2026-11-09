# How each Provider registers a tool server, and over which transport

Research for #171 (child of map #170, Messages between Terminals). Question: how do Claude Code, OpenCode and Codex each register a tool (MCP) server persistently in their own config, which transports do they accept, which file and entry would Timmy write, how can Timmy later remove only its own entry (ADR 0009), and does registration differ per project or per user.

Researched 2026-11-09. Primary sources only: each Provider's documentation, and for OpenCode and Codex their source at the pinned release. Claude Code's source is closed, so for it the documentation is the primary source. Statements marked **Inference** are mine, not a source's. Statements marked **Not verified** were not confirmed against a primary source.

Pinned versions:

- Claude Code: docs as served on 2026-11-09 (the docs name versions such as v2.1.287 for individual features).
- OpenCode: release `v2.2.6` (2026-11-06), commit `dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`, repo `anomalyco/opencode`.
- Codex: release `rust-v0.167.0` (2026-11-06), commit `086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a`, repo `openai/codex`.

## Summary

| | Claude Code | OpenCode | Codex |
|---|---|---|---|
| Transports | stdio, `http` (Streamable HTTP), `sse` (deprecated), `ws` | stdio (`local`), Streamable HTTP (`remote`) | stdio, Streamable HTTP |
| User-level file | `~/.claude.json` (`mcpServers`, scope `user`) | `~/.config/opencode/opencode.json` or `.jsonc` | `~/.codex/config.toml` |
| Project-level file | `.mcp.json` (shared, asks approval) or `~/.claude.json` under the project path (private, default) | `opencode.json(c)` or `.opencode/opencode.json(c)` in the project | `.codex/config.toml`, trusted projects only |
| Entry Timmy writes | `mcpServers.<name>` | `mcp.servers.<name>` (native) or `mcp.<name>` (legacy), both accepted | `[mcp_servers.<name>]` |
| CLI to add | `claude mcp add` / `add-json` | `opencode mcp add` | `codex mcp add` (user level only) |
| CLI to remove | `claude mcp remove <name> [--scope s]` | none; delete the key | `codex mcp remove <name>` (user level only) |
| Header from an env var | `${VAR}` in `headers` | `{env:VAR}` anywhere in the config text | `env_http_headers = { Header = "VAR" }` |
| Env var in the URL | `${VAR}` in `url` | `{env:VAR}` in `url` | not documented, not found in source |

Loopback HTTP is accepted by all three. Removal of only Timmy's entry is possible for all three, with different tools (below).

## Claude Code

Source for everything in this section unless noted: [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp) and [Settings files and precedence](https://code.claude.com/docs/en/settings).

### Transports

- `http` is the recommended remote transport: `claude mcp add --transport http <name> <url>`. The JSON `type` also accepts `streamable-http` as an alias.
- `sse` is deprecated: "The SSE (Server-Sent Events) transport is deprecated. Use HTTP servers instead, where available."
- `stdio`: `claude mcp add [options] <name> -- <command> [args...]`. An entry with no `type` is read as stdio; a `url` entry with no `type` is an error.
- `ws` (WebSocket) exists, but `--transport` does not accept it; it is set only through `claude mcp add-json` or `.mcp.json`.
- Nothing on the page restricts HTTP servers to non-loopback hosts. OAuth credentials may go to `localhost`, `127.0.0.1` or `::1` token endpoints over plain `http`, which implies loopback is an accepted address class. (The page says this about token endpoints only; it says nothing about loopback MCP URLs specifically.)

### Where the entry lives, and per project or per user

Registration differs by scope. The page's table:

| Scope | Loads in | Shared | Stored in |
|---|---|---|---|
| Local (default) | current project only | no | `~/.claude.json`, under that project's path |
| Project | current project only | yes, via version control | `.mcp.json` in the project root |
| User | all projects | no | `~/.claude.json` |

Entry shapes from the page:

```json
{ "mcpServers": { "shared-server": { "type": "http", "url": "https://example.com/mcp" } } }
```

```json
{ "projects": { "/path/to/your/project": { "mcpServers": { "stripe": { "type": "http", "url": "https://mcp.stripe.com" } } } } }
```

(The first is a `.mcp.json`, and the same `mcpServers` map sits at the top level of `~/.claude.json` for user scope; the second is a local-scope entry.)

Precedence is local, then project, then user, then plugin servers, then claude.ai connectors. "Fields are not merged across scopes": the whole winning entry is used.

Project scope (`.mcp.json`) prompts for approval in interactive sessions, and the page says a cloned repo cannot approve its own servers. User and local scope have no such prompt documented. Persistent activation per user (ADR 0009's model, which edits `~/.claude/settings.json` for the hook) therefore maps to **user scope** in `~/.claude.json`, not to the settings file: the settings page lists `~/.claude/settings.json` for personal preferences and permissions, and says `~/.claude.json` is the file that "holds your account details, MCP server configurations, per-project state such as trust decisions, and the global config keys".

### Writing and removing only Timmy's entry

- Add: `claude mcp add --scope user --transport http timmy <url>` or `claude mcp add-json --scope user timmy '<json>'`.
- Remove: `claude mcp remove <name>`. The duplicate-name warning on the page shows `claude mcp remove <name> --scope <scope>`. Removing a remote server also deletes its stored OAuth tokens and client registration locally.
- The settings page says of `~/.claude.json`: "that it writes for itself; you don't need to edit it". If it cannot be parsed, Claude Code copies it to `~/.claude/backups/.claude.json.corrupted.<timestamp>` and asks whether to exit or reset to defaults.
- **Inference:** because Claude Code itself rewrites `~/.claude.json` while running (account details, trust decisions), Timmy editing it as raw JSON risks a lost-update race and a parse-failure prompt; shelling out to `claude mcp add/remove` leaves the write to the owner of the file. The cost is that Timmy needs the `claude` binary on its PATH at activation time. Not verified: whether the CLI write is atomic or locked.

### Passing the Terminal's identity to the server

- `${VAR}` and `${VAR:-default}` expansion works in `command`, `args`, `env`, `url` and `headers`. The page documents it in the `.mcp.json` section, and a passage on `CLAUDE_PROJECT_DIR` also names "a local- or user-scoped server entry in `~/.claude.json`", so expansion appears to apply there too; the page never states it in the expansion section itself.
- A variable that is unset with no default leaves the literal `${VAR}` text in place, and `claude mcp list` shows a warning. A header would therefore arrive as the literal string `${TIMMY_TERMINAL_ID}` outside Timmy.
- Some credential-like variable names read as empty in remote `url` and `headers` (for example `ANTHROPIC_API_KEY`, `HTTPS_PROXY`, `NPM_TOKEN`); "a name outside this set, such as `API_KEY`, expands as written". A `TIMMY_*` name is outside the set.
- The page does not say whether a stdio server inherits Claude Code's environment. Not verified.

### Other

- `managedMcpServers` and `managed-mcp.json` (organization policy) outrank every user entry, and `disabledMcpjsonServers` in any settings file rejects a server by name; an organization can therefore block Timmy's entry.

## OpenCode

Sources: release `v2.2.6` source files cited below, and the docs file in the same tree, [`mcp-servers.mdx`](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/web/src/content/docs/mcp-servers.mdx). The released docs file and the released code disagree on the config shape, so this section follows the code.

### Transports

- `local`: a stdio process; `command` is an array. Spawned with the host environment extended by `environment` (`extendEnv: true`): [`packages/core/src/mcp/stdio.ts`](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/mcp/stdio.ts) and [`packages/core/src/mcp/client.ts` L326-L338](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/mcp/client.ts#L326-L338).
- `remote`: a URL, connected only with `StreamableHTTPClientTransport` ([`client.ts` L346-L356](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/mcp/client.ts#L346-L356)). No SSE transport is constructed in that file. The docs call the field "URL of the remote MCP server"; the schema accepts any string ([`packages/schema/src/mcp.ts`](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/schema/src/mcp.ts)), so a loopback URL is not rejected at config level.
- **Gotcha:** for `remote` servers OpenCode adds `?codemode=false` to the URL unless `codemode: false` is set or the URL already has the parameter, and retries at the configured URL on a 400 or 404 (`client.ts` L342-L368). Timmy's server should tolerate an unknown query parameter, or the entry should set `codemode: false`.

### Where the entry lives, and per project or per user

- Config files are named `opencode.json` or `opencode.jsonc` ([`config/discovery.ts` L12](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/config/discovery.ts#L12)), read from the global config directory and from the project (including a `.opencode/` directory).
- The global directory is `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`, on every platform including Windows ([`packages/util/src/global-roots.ts`](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/util/src/global-roots.ts)). There are also system and managed locations (`discovery.ts`).
- The CLI picks the first existing file among `opencode.json`, `opencode.jsonc`, `.opencode/opencode.json`, `.opencode/opencode.jsonc` in the chosen directory, else creates `opencode.json`. `--global` selects the global directory, otherwise the current working directory ([`cli/.../mcp/add.ts` L33-L57](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/cli/src/commands/handlers/mcp/add.ts#L33-L57)).
- So OpenCode registration is per user (global file) or per project (project file), the same as Claude Code's user and project scopes. A project entry replaces a same-named global one entirely.

### Entry shape: two shapes are accepted

- **Native** (what `opencode mcp add` writes): `mcp.servers.<name>`, with `type: "local" | "remote"`, `disabled` (not `enabled`), `timeout` as an object `{startup, catalog, execution}`. `add.ts` L64 writes `["mcp", "servers", name]`; the schema is [`schema/src/mcp.ts` L26-L75](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/schema/src/mcp.ts#L26-L75).
- **Legacy** (what the released docs file shows): `mcp.<name>` with `enabled` and a numeric `timeout`. The normalizer still accepts it and migrates it ([`config/normalize.ts` L250-L295](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/config/normalize.ts#L250-L295), [`v1/config/migrate.ts` L81-L108](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/v1/config/migrate.ts#L81-L108)).
- In the legacy shape a server literally named `servers` or `timeout` is ambiguous; any other name is fine. (`normalize.ts` L267-L290.)
- **Inference:** an older OpenCode (v1.x) would likely read only the legacy shape, so writing `mcp.<name>` would work on both while `mcp.servers.<name>` might not. Not verified against a v1 release.
- Not verified: the live page at `opencode.ai/docs/mcp-servers` showed the native shape (`mcp.servers`, `disabled`) when fetched, whereas the `v2.2.6` docs file shows the legacy one. The docs are in flux; the code is the stable reference.

### Writing and removing only Timmy's entry

- Add: `opencode mcp add <name> --url <url> [--header 'K=V'] [--global]` or `opencode mcp add <name> [--env K=V] -- <command...>`. It edits the file with `jsonc-parser`'s `modify`, which edits one path in place and keeps the rest of the text, comments included (`add.ts` L59-L68).
- There is **no** `opencode mcp remove`: the CLI handlers in the tree are `add`, `auth`, `list`, `logout`, `resolve` ([`packages/cli/src/commands/handlers/mcp`](https://github.com/anomalyco/opencode/tree/v2.2.6/packages/cli/src/commands/handlers/mcp)). The docs say to delete the entry from the config where it was added.
- **Inference:** Timmy can remove its key with the same `jsonc-parser` `modify(text, ["mcp","servers","timmy"], undefined)` call, which touches only that path. Timmy must handle both shapes if it wants to remove an entry a user migrated or hand-edited, and `opencode.json` may also be `.jsonc` or live under `.opencode/`, so removal must search the same four candidates.

### Passing the Terminal's identity to the server

- `{env:VAR}` is substituted textually across the whole config text from the process environment, an unset variable becoming an empty string ([`config/variable.ts` L25-L38](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/config/variable.ts#L25-L38)). It works in `url` and `headers`. Shell syntax like `$NAME` is not expanded.
- A stdio server inherits the host environment, so `TIMMY_TERMINAL_ID` would reach it without configuration.

## Codex

Sources: [MCP page](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) (redirected from `developers.openai.com/codex/mcp`), [config basics](https://learn.chatgpt.com/docs/config-file/config-basic), and source at `rust-v0.167.0`.

### Transports

- Two, chosen by which key is present: stdio (`command`) or Streamable HTTP (`url`). The Rust type is an untagged enum with `deny_unknown_fields`, annotated with the MCP spec's stdio and Streamable HTTP transport links; there is no SSE variant ([`codex-rs/config/src/mcp_types.rs` L650-L688](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/config/src/mcp_types.rs#L650-L688)).
- Mixing keys (for example `url` with `command`, or `bearer_token_env_var` on a stdio server) is rejected when the config is parsed (`mcp_types.rs` L514-L560).
- **Consequence of `deny_unknown_fields`:** a field Codex does not know makes that server entry invalid. Timmy should write only documented fields.
- The docs call the HTTP transport one that "you access at an address"; no loopback restriction is documented.

### Where the entry lives, and per project or per user

- User level: `~/.codex/config.toml`, table `[mcp_servers.<name>]` ([MCP page](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)). The CLI's error text names `CODEX_HOME` as the resolved directory (`mcp_cmd.rs` L511, `find_codex_home`); I did not read `find_codex_home` itself, so the variable's exact role is **Not verified**.
- Project level: "scope MCP servers to a project with `.codex/config.toml` (trusted projects only)". The config page adds: "Codex loads project `.codex/` layers only when you trust the project", with the closest project file winning over the user file. That page does not say whether `mcp_servers` is allowed in a project file; the MCP page says it is.
- `codex mcp add` and `codex mcp remove` operate on the **global** (user) file only: they call `load_global_mcp_servers`, and print "Added global MCP server" / "Removed global MCP server" ([`mcp_cmd.rs` L447-L459, L502-L527](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/cli/src/mcp_cmd.rs#L447-L459)).

Entry shapes (fields from the MCP page and `mcp_types.rs`):

```toml
[mcp_servers.timmy]
url = "http://127.0.0.1:PORT/mcp"
env_http_headers = { "X-Timmy-Terminal" = "TIMMY_TERMINAL_ID" }
enabled = true
```

```toml
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
env_vars = ["LOCAL_TOKEN"]
```

(The first block is illustrative for Timmy; the second is the docs' own example shape. Option names for HTTP: `url`, `bearer_token_env_var`, `http_headers`, `env_http_headers`, `http_headers_helper`; common: `enabled`, `required`, `startup_timeout_sec` default 10, `tool_timeout_sec` default 60, `enabled_tools`.)

### Writing and removing only Timmy's entry

- `codex mcp add <name> --url <url> [--bearer-token-env-var VAR] ...` or `codex mcp add <name> [--env K=V] -- <command...>` ([`mcp_cmd.rs` L100-L190](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/cli/src/mcp_cmd.rs#L100-L190)). `add --url` has no flag for static or env headers; `env_http_headers` has to be written into the TOML another way.
- `codex mcp remove <name>` exists in source (`McpSubcommand::Remove`, `mcp_cmd.rs` L78, L207, L502) even though the MCP docs page does not mention it. It loads the global servers, deletes the one key, and writes back.
- The write goes through `ConfigEdit::ReplaceMcpServers` on a `toml_edit` document ([`codex-rs/core/src/config/edit.rs` L443-L490](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/core/src/config/edit.rs#L443-L490)): it removes keys absent from the passed map and re-serializes the others through the typed config. Because the CLI passes the map it just loaded, other servers survive, but their entries are re-serialized, so unknown fields or exact formatting of other entries may change. A `toml_edit` document keeps unrelated tables and comments. **Inference:** running `codex mcp add/remove` is a safe way to touch only Timmy's entry; editing the TOML directly with a format-preserving editor is the alternative if Timmy cannot depend on the binary. Not verified: behavior of `codex mcp remove` when the file has a server entry Codex cannot parse (loading fails first, per `mcp_edit.rs`).
- An inline `bearer_token` in the file is rejected ("uses unsupported `bearer_token`; set `bearer_token_env_var`", [`mcp_edit.rs`](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/config/src/mcp_edit.rs)).

### Passing the Terminal's identity to the server

- `env_http_headers` maps a header name to an environment variable name. At connection time Codex reads the variable; if it is unset or blank the header is silently omitted ([`rmcp-client/src/utils.rs` L103-L145](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/rmcp-client/src/utils.rs#L103-L145)). Outside Timmy the header is therefore absent, which is a clean "no Terminal id" signal.
- `url` has no documented variable expansion, and none was found in the files read. So unlike Claude Code and OpenCode, the loopback address cannot be passed to Codex via an env var in the URL. Not verified exhaustively: the config loader was not searched for a general interpolation pass.
- Stdio servers do **not** inherit the full environment: they get a fixed allowlist (`DEFAULT_ENV_VARS`) plus names listed in `env_vars`, plus `env` ([`utils.rs` L15-L50](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/rmcp-client/src/utils.rs#L15-L50)). A stdio shim for Timmy would need `env_vars = ["TIMMY_TERMINAL_ID"]`.

## What this means for Timmy (inference, not sourced)

1. **HTTP on loopback is the common denominator.** All three speak Streamable HTTP, so one server in main can serve every Provider. Stdio would need a shim process per Terminal, and the three Providers pass it a different environment (OpenCode inherits it, Codex filters it, Claude Code's page is silent).
2. **Registration is per user for persistent activation** (ADR 0009's model): Claude Code user scope in `~/.claude.json`, OpenCode global `opencode.json(c)`, Codex `~/.codex/config.toml`. All three also offer per-project scopes that Timmy would not need.
3. **How Timmy learns which Terminal is calling** can ride the same mechanism as the Hook: an env var set on every Terminal Timmy starts, forwarded as a header (Claude Code `${VAR}`, OpenCode `{env:VAR}`, Codex `env_http_headers`). The three differ on what happens outside Timmy: Claude Code sends the literal `${TIMMY_TERMINAL_ID}`, OpenCode sends an empty string, Codex omits the header. The server must treat all three as "not a Timmy Terminal".
4. **Unlike the Hook, the entry is not silent outside Timmy.** A Hook that finds no `TIMMY_TERMINAL_ID` does nothing. A registered tool server will still be started or contacted by the CLI, and with Timmy not running, the loopback address is dead, so the CLI will show a failed server. Whether that is acceptable, or the entry's address should come from an env var so it is empty outside Timmy (possible for Claude Code and OpenCode, not documented for Codex), is a decision for the map.
5. **Removal of only Timmy's entry is feasible everywhere** by a fixed, Timmy-owned server name (for example `timmy`): `claude mcp remove --scope user`, `codex mcp remove`, and for OpenCode a path-targeted JSONC edit since it has no remove command. Using the CLI where one exists avoids Timmy writing `~/.claude.json` (rewritten by Claude Code itself) or Codex's TOML by hand.
6. **Organization policy can override.** Claude Code's managed settings can block an MCP server by name; this is not specific to Timmy but means activation can succeed and the tool still be absent.

## Open questions this note does not settle

- Whether Claude Code's `${VAR}` expansion is applied to `url` and `headers` of user-scope entries in `~/.claude.json` in practice (the docs imply it; a one-line test would settle it).
- Codex: whether `url` supports any interpolation, and the role of `CODEX_HOME`.
- OpenCode: whether v1.x releases accept `mcp.servers`, and how long the legacy `mcp.<name>` shape stays accepted.
- Whether each CLI re-reads its config at runtime or only at start, so a running Terminal picks up a newly activated or removed entry. OpenCode has a `config.updated` event that reloads MCP (`config/plugin/mcp.ts`); Claude Code and Codex were not checked.
- Which tool names each Provider shows the model for an MCP tool, and each Provider's own approval prompts for MCP calls (relevant to the approval prompt in the map; out of scope here).
