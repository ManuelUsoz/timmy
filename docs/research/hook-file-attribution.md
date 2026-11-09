# Can a Hook say which files an agent edited?

Research for issue #163 (parent map #159). Date of the research: 2026-11-09.

Question: the design canvas says "4 lineas cambiadas por claude". Can Timmy know which files a given agent edited, using the Hook of each Provider it hosts (Claude Code, Codex, OpenCode)? The answer decides whether attribution is built, reduced to "changed in this session", or dropped.

## Answer in short

- **Claude Code**: yes, at file granularity, with holes. `PostToolUse` for `Edit` and `Write` carries the absolute file path and, in `tool_response`, a structured diff with line numbers. Edits made through `Bash` are not covered unless a beta field (`bashEditDiff`) is present.
- **Codex**: partly. `PostToolUse` fires for `apply_patch`, but the input is the raw patch text (file paths are inside it, in Codex's patch format), not a path field. What `tool_response` holds for `apply_patch` is not documented.
- **OpenCode**: partly, and the API is in transition. Events `file.edited` (payload: a path only) and `session.diff` (per-file patches with additions and deletions) exist. The repo has no OpenCode Hook Integration yet.
- **No Provider** reports "which lines this agent wrote" in a form that stays true. Line ranges go stale with the next edit and by the user's own edits.
- The one mechanism that works for all three is provider-agnostic: at the moments every Hook already reports (a tool finished, the turn is `Done`), main runs `git status` on the Project and attributes the delta to the Terminal that reported. The Providers' own docs suggest exactly this for Claude Code. Per-tool paths are then a precision hint, not the source of truth.
- Recommendation: **reduce**. See the end.

## What Timmy's Hook Integration already receives

Source: `electron/hooks/` in this repo, ADR 0008, ADR 0009, GLOSSARY.md (Hook, Integration, Provider).

- Only one Integration exists today: `makeClaudeCodeHook` (`electron/hooks/hook-integrations.ts` lists only it). ADR 0008 puts OpenCode first in order of support, but no OpenCode or Codex Hook is built.
- The Claude Code Hook writes entries for `UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop`, `SessionEnd` into `~/.claude/settings.json` (`EVENTS` in `claude-code-hook.ts`). The `PostToolUse` entry has no matcher, so it fires after every successful tool call, not only edits.
- Every event is posted whole (`curl --data-binary @-`, the JSON Claude Code writes on stdin) to the loopback channel at `/hook/<token>/<terminalId>/ClaudeCode`. The channel accepts bodies up to 16 MiB and its own comment says an event "carries the tool's input and output". So the payload, including `tool_input.file_path` and `tool_response`, already arrives in main.
- Then it is thrown away. `HookIntegration.decode` returns only `Option<HookSignal>` (`Working`, `Waiting`, `Done`, `Ended`), and `HookReport` is `{ terminalId, signal }`. Nothing in `tool_input`, `tool_response`, `cwd`, `session_id`, `agent_id` is kept.
- Identity comes for free: the Terminal id is in the URL path (it is the `TIMMY_TERMINAL_ID` env of the Terminal), so any path reported is already tied to one Terminal. "By one agent" means "by one Terminal" (one CLI instance), and a subagent inside that CLI is folded into it.
- What is missing for attribution: `decode` would need a second output (touched paths, an optional diff summary) next to the signal, and `HookReport` would need to carry it. No Provider-specific code would leak beyond the Integration.

## Claude Code

Primary source: Claude Code hooks reference (`https://code.claude.com/docs/en/hooks`, read in its Markdown form) and the Agent SDK TypeScript reference (`https://code.claude.com/docs/en/agent-sdk/typescript`) for tool output shapes.

### Events that carry a file or a diff

| Event | What it carries | Granularity |
| --- | --- | --- |
| `PreToolUse` (`Write`, `Edit`) | `tool_input.file_path` (absolute), plus `content` or `old_string` / `new_string` / `replace_all` | File; the intended change, before it ran |
| `PostToolUse` (`Write`) | `tool_input.file_path`, `content`; `tool_response` is documented in the hooks page only as `{ filePath, type: "create" }` | File |
| `PostToolUse` (`Edit`) | `tool_input` as above; `tool_response` shape is in the SDK reference, see below | File, with hunks |
| `PostToolUse` (`NotebookEdit`) | SDK reference: input has `notebook_path`, `cell_id`, `edit_mode`; output has `original_file` and `updated_file` | File (whole notebook text before and after) |
| `PostToolUse` (`Bash`, `PowerShell`) | `tool_input.command`; optionally `tool_response.bashEditDiff` with `changedFiles` (absolute paths, at most 200), `files` (diffs of at most 5 files with `hunks`, `created` or `deleted`), `moreFiles`, `unavailable`, `skipped`, `shared` | File, with hunks for 5 files |
| `FileChanged` | `file_path` (absolute) and `event` (`change`, `add`, `unlink`), whatever wrote the file | File |
| Common fields, all events | `session_id`, `cwd`, `transcript_path`, `permission_mode`, `hook_event_name`; `agent_id` and `agent_type` inside a subagent | n/a |

Details that matter:

- The SDK reference gives the Edit output as `{ filePath, oldString, newString, originalFile, structuredPatch: [{ oldStart, oldLines, newStart, newLines, lines }], userModified, replaceAll, gitDiff? }`, and the Write output as `{ type: "create" | "update", filePath, content, structuredPatch, originalFile, gitDiff?, userModified? }`. The hooks page says the `PostToolUse` schema "depends on the tool" and only shows the short Write example. The hooks page does not state that `PostToolUse` carries the SDK output shape verbatim, so I treat `structuredPatch` in a hook payload as **likely, not confirmed** until someone logs a real payload.
- `structuredPatch` is empty for a newly created file, for a write that changed nothing, when the previous content is larger than about 10 MB, or when diffing timed out (SDK reference, Write section).
- Paths in file-tool `tool_input` are always absolute, with the platform's native separators: backslashes on Windows (hooks page, PreToolUse input). Timmy must normalize before comparing with `git` output.
- `PostToolUse` fires only after a tool **succeeds**; failures go to `PostToolUseFailure`. A failed edit changed nothing, so ignoring it is correct.
- Subagents: "tool events such as `PreToolUse` and `PostToolUse` fire the same configured hooks as in the main conversation, and the input carries the `agent_id` and `agent_type`" (hooks page). Edits by a subagent reach Timmy's existing entry.
- The hooks page states "Claude Code doesn't run a `PostToolUse` hook matching `Edit|Write` when a `Bash` command or a process outside Claude Code rewrites the same file." So `sed -i`, formatters, codegen and `git` commands are invisible to `Edit|Write` hooks.
- `bashEditDiff` is "best effort and in public beta" per the page, needs Claude Code v2.1.269 or later, and is recorded in every permission mode only if `bashEditDiffEnabled` is on; otherwise only in `auto` and `bypassPermissions` mode. It can miss changes, include another process's change (`shared`), and skips Git-ignored files and submodules. The page says to "use the list to find what to review, not to enforce a policy".
- `FileChanged` is not a drop-in for "watch the whole Project": its `matcher` builds a watch list of **literal filenames in the working directory**; `"*"` is registered as a file literally named `*`; a dynamic list needs `watchPaths` returned by a `SessionStart` or `CwdChanged` hook (hooks page, FileChanged section). It also cannot tell which agent wrote the file.
- The hooks page itself recommends, for "after any tool completes successfully": "Your hook can then discover what changed itself, for example by running `git status --porcelain`, which also lists untracked files that `git diff` misses."
- Worktrees: after Claude enters a worktree, `cwd` becomes the worktree root while `CLAUDE_PROJECT_DIR` stays the original root. `cwd` in a payload cannot be assumed to be the Project root.

### Granularity and unknowns

- File level: reliable for `Edit`, `Write`, `NotebookEdit`. Lines: `structuredPatch` hunks give `newStart` and `newLines` at the moment of the edit only (unconfirmed in hooks, see above).
- Unknown: the exact `tool_response` for `Edit` inside a hook (needs one logged payload); whether `MultiEdit` still exists (the string does not appear in the hooks page or the SDK reference, so it appears removed); behaviour on Windows of the existing `COMMAND` (a `sh` snippet with `curl`) is outside this ticket.

## Codex

Primary sources: Codex hooks documentation (`https://developers.openai.com/codex/hooks`, which redirects to `https://learn.chatgpt.com/docs/hooks`), and the open source repository `openai/codex`: `codex-rs/hooks/schema/generated/post-tool-use.command.input.schema.json`, `codex-rs/core/src/tools/handlers/apply_patch.rs`, `codex-rs/core/assets/tools/apply_patch.lark`.

### Events that carry a file or a diff

| Event | What it carries | Granularity |
| --- | --- | --- |
| `PreToolUse` / `PostToolUse` for `apply_patch` | `tool_name: "apply_patch"`, `tool_input: { "command": <raw patch text> }`, `tool_use_id`, `turn_id`, `cwd`, `session_id` | File and hunks, but parsed from patch text |
| `PostToolUse` for `Bash` (shell and unified exec) | `tool_input.command` (the command string); `tool_response` is the model-facing output | None: no file list |
| `PostToolUse` for MCP and other local tools | The call's arguments; MCP result in `tool_response` | Depends on the tool |
| Common fields | `session_id`, `transcript_path`, `cwd`, `model`, `permission_mode`, `turn_id`; optional `agent_id`, `agent_type` | n/a |

Details that matter:

- The docs list `apply_patch` as a covered tool path for both `PreToolUse` and `PostToolUse`, matched as `apply_patch`, `Edit` or `Write`, while "hook input still reports `tool_name: "apply_patch"`". Hosted tools such as WebSearch do not use the hook path.
- In the source, `post_tool_use_payload` sets `tool_input` to `{"command": <patch text>}`, the same as `pre_tool_use_payload`. The patch grammar (`apply_patch.lark`) is an envelope between `*** Begin Patch` and `*** End Patch` with hunks `*** Add File: <path>`, `*** Delete File: <path>`, `*** Update File: <path>` with an optional `*** Move to: <path>`, and update bodies made of `@@` context lines and `+`, `-`, space lines. So a file path list **can** be extracted by parsing the headers: add, update, delete, rename, all with the operation. Line ranges are not available: `@@` carries context text, not absolute line numbers.
- The source builds a `file_paths_for_action` list for permissions, but it is not part of the hook payload (the payload code only has the command).
- `tool_response` for `apply_patch` comes from `result.post_tool_use_response(...)`; I could not see its content. **Unknown.**
- The docs warn: "Treat tool hooks as a useful guardrail, not a complete enforcement boundary." A shell command that edits files (`sed -i`, `python`, redirects) is a `Bash` call with no structured file list.
- Codex has no file-change event. Its events are session, prompt, tool, permission, compaction, model request, interrupt, subagent and stop events.
- Hooks live in `~/.codex/hooks.json` or `config.toml` (and per repo under `.codex/`), enabled by default. Non-managed hooks must be reviewed and trusted by hash in `/hooks` before they run, and a changed hook is skipped until trusted again. This affects the "activate persistently" model of ADR 0009 for Codex, but not this ticket's question.
- Subagent hooks use the parent session id; `agent_id` is optional.

### Granularity and unknowns

- File (with add/update/delete/move) for `apply_patch`; hunks as text only. Shell edits: none.
- Unknown: whether paths in a patch are relative to `cwd` always (the payload has `cwd`, the source mentions a `tool_cwd` for the post event); `tool_response` content for `apply_patch`; how often Codex edits through `apply_patch` versus shell in practice (the repo has a warning for `apply_patch` invoked through `exec_command`, `legacy_apply_patch_exec_command_warning.rs`, which suggests both paths exist).

## OpenCode

Primary sources: OpenCode docs (`https://opencode.ai/docs/plugins/`, `.../build/plugins`, `.../build/plugins/server`) and the repository `anomalyco/opencode`, branch `dev`: `packages/web/src/content/docs/plugins.mdx`, `packages/schema/src/v1/filesystem.ts`, `packages/schema/src/v1/session.ts`, `packages/schema/src/file-diff.ts`, `packages/plugin/src/promise/tool.ts`.

OpenCode's plugin API is mid-migration. The pages on opencode.ai now describe a new `setup(ctx)` model with `ctx.tool.hook(...)` and `ctx.event.subscribe(...)`, while the docs source in the repo (`plugins.mdx`) still describes the earlier model: a plugin function receiving `{ project, client, $, directory, worktree }` and returning hooks and event handlers. Both name the same events. An Integration would target whichever is current in the release Timmy supports; this needs to be fixed when the OpenCode Hook is built.

### Events that carry a file or a diff

| Event / hook | What it carries | Granularity |
| --- | --- | --- |
| `file.edited` | Payload schema is `{ file: string }` (`FileSystemV1.Event.Edited`) | File, no diff |
| `file.watcher.updated` | Listed in the docs; payload not verified in this research | File (presumably) |
| `session.diff` | `{ sessionID, diff: FileDiff[] }`; each entry has `file`, `patch`, `additions`, `deletions`, `status` (`added`, `deleted`, `modified`) (legacy shape marks several fields optional) | File, with a full unified patch and counts, cumulative for the session |
| `tool.execute.before` / `tool.execute.after` | New API: `tool`, `sessionID`, `agent`, `messageID`, `id`, `input`, and `result` or `error` on `after`. Old API example: `output.args.filePath` for the `read` tool | Whatever the tool's args hold; edit/write arg names not verified |
| `message.part.updated`, `message.updated` | Message parts, including tool parts | Not verified for file info |
| Plugin context | `directory`, `worktree`, `project` (old); `ctx.location.directory`, `ctx.vcs`, `ctx.worktree` (new) | n/a |

Details that matter:

- `session.diff` is the most useful single signal in any of the three Providers: per-file `patch`, `additions` and `deletions` for the session. It gives "4 lines changed" counts and a diff, scoped to a session, so one Terminal. Unverified: how the diff is computed (the code and the docs I read do not say; if it is snapshot-based it includes edits made through the shell and by the user), and when it is emitted.
- `file.edited`: the schema is just a path. Where OpenCode emits it (only for its edit and write tools, or for any change) is not stated in what I read. **Unknown.**
- OpenCode is installed by dropping a plugin into `.opencode/plugins/` or `~/.config/opencode/plugins/` (docs), which fits ADR 0009's "an OpenCode plugin" activation.

### Granularity and unknowns

- File level, with patch text and counts through `session.diff`. Line ranges can be derived from the patch hunks, with the same staleness problem as elsewhere.
- Unknown: emission sites of `file.edited`; the semantics of `session.diff`; edit and write tool arg names; which plugin API generation a given user's OpenCode runs.

## Cross-cutting limits (all Providers)

1. **Shell edits are the hole.** Edits by `sed`, a formatter, `npm install`, codegen or `git` are structured only in Claude Code's beta `bashEditDiff`. For Codex they are invisible to path-bearing events; for OpenCode, `session.diff` may or may not include them.
2. **The user edits too.** Neither a tool path nor `git status` can say who typed a change. `userModified` in Claude Code's output only covers the edit-approval flow.
3. **Two agents, one file.** Two Terminals can touch the same file, and a file can be edited by an agent and then by the user. Attribution is many-to-many, so a single "changed by X" label is wrong in these cases.
4. **Line ranges expire.** A range from `structuredPatch` or a patch hunk is valid at the instant of the edit. Any later edit above it shifts the range. Keeping them true needs Timmy to re-diff, which is what `git diff` already does.
5. **Concurrent agents in one worktree.** A `git status` delta taken when Terminal A reports may contain Terminal B's edits (Claude's own `shared` flag admits the same problem). Per-tool paths are the hint that resolves some of these.
6. **Paths.** Claude Code gives absolute paths with backslashes on Windows; Codex patch headers carry paths whose base is unverified; `cwd` can be a worktree rather than the Project root. All need normalizing against the Project root before use in the tree.
7. **Cost and trust.** The payload already reaches main (16 MiB cap). Keeping only a path list and counts, and dropping `content`, `originalFile` and patch bodies, keeps the data small and avoids storing source text that is not needed.

## Options

| Option | What it needs | What the user sees | Verdict |
| --- | --- | --- | --- |
| A. Build full attribution, with line ranges per agent | Parse each Provider's diffs, store ranges, keep them valid across edits and user changes | "4 lines changed by claude . handshake" exactly as drawn | Not feasible honestly: shell and user edits break it, ranges go stale, Codex and OpenCode give no ranges in hooks |
| B. File-level attribution, best effort | `decode` returns touched paths per report; for each Terminal, union of paths from `Edit`/`Write`/`apply_patch`, plus a `git status` delta at `Done`; show "touched by <agent>" on a file, only when known | Tree and reader mark the files an agent touched, with a name; unknown stays unmarked | Feasible for Claude Code now, Codex for `apply_patch`, OpenCode via `session.diff`; labelled as best effort |
| C. "Changed in this session" | `git status` of the Project in main (already planned by #159 for the changed markers); a baseline at Terminal start to scope "this session" | Files changed, no agent name | Feasible for all Providers, even those with no Hook (OpenCode and Codex Integrations are not built) |
| D. Drop | Nothing | Nothing | Loses the one hint the canvas promises, with no cost saving over C |

## Recommendation: reduce

Build **C first** and treat **B as a later, optional layer**; drop line-level attribution (A).

1. Slice 1 of #159 (changed markers, "N con cambios") stays on `git status`, as the map already says. That is the truth for all Providers, including those without a Hook, and it already answers "which files should I look at".
2. "Changed in this session" is what the reader can honestly show for every Provider. Do not draw "N lines changed by claude" as a per-agent line count; draw counts from `git diff` of the file, unattributed.
3. If an agent name is wanted on a file, add B as a thin extension of the Hook Integration: `decode` returns the touched paths next to the signal (Claude Code: `tool_input.file_path` for `Edit`, `Write`, `NotebookEdit`, plus `bashEditDiff.changedFiles` when present; Codex: headers of the `apply_patch` text; OpenCode: `file.edited` and `session.diff`). Attribute a `git status` delta to the Terminal that reported `Done` as a fallback, and mark it "shared" when more than one Terminal of the Project worked in that window. Show a name only when exactly one Terminal touched the file; otherwise show nothing or "several agents".
4. Because only the Claude Code Integration exists, B would be built for Claude Code first. For the other Providers the UI must degrade to C without any visible gap.
5. Before building B, log one real `PostToolUse` payload for `Edit` and `Write` (Claude Code) and one for `apply_patch` (Codex) to settle the unknowns above; it is cheap, because the channel already receives them.

What stays unknown even after B: who wrote a change when the user and an agent both touched a file, shell-made edits for Codex and for Claude Code outside auto mode without `bashEditDiffEnabled`, and any per-line authorship.

This changes the map's "Not yet specified" item "Showing 'changed by <agent>' in the reader": it can shrink to a file-level label that is shown only when known, or vanish, without blocking any of the delivery slices 1 to 5.

## Sources

Repo (this worktree): `electron/hooks/claude-code-hook.ts`, `hook-channel.ts`, `hook-integration.ts`, `hook-integrations.ts`; `src/shared/hooks/hooks.model.ts`; `docs/adr/0008-timmy-hosts-provider-clis-in-terminals.md`; `docs/adr/0009-hooks-are-installed-persistently-and-inert-outside-timmy.md`; `GLOSSARY.md`.

Claude Code:
- Hooks reference: https://code.claude.com/docs/en/hooks (Markdown form: https://code.claude.com/docs/en/hooks.md). Sections: Common input fields, PreToolUse input (Bash, Write, Edit), PostToolUse, FileChanged, SubagentStart/SubagentStop, WorktreeCreate.
- Agent SDK TypeScript reference, tool input and output types (`FileEditOutput`, `FileWriteOutput`, `NotebookEditInput`, `NotebookEditOutput`): https://code.claude.com/docs/en/agent-sdk/typescript

Codex:
- Hooks documentation: https://developers.openai.com/codex/hooks (redirects to https://learn.chatgpt.com/docs/hooks)
- Source: https://github.com/openai/codex, paths `codex-rs/hooks/schema/generated/post-tool-use.command.input.schema.json`, `codex-rs/core/src/tools/handlers/apply_patch.rs`, `codex-rs/core/assets/tools/apply_patch.lark`

OpenCode:
- Docs: https://opencode.ai/docs/plugins/, https://opencode.ai/docs/build/plugins, https://opencode.ai/docs/build/plugins/server
- Source: https://github.com/anomalyco/opencode (branch `dev`), paths `packages/web/src/content/docs/plugins.mdx`, `packages/schema/src/v1/filesystem.ts`, `packages/schema/src/v1/session.ts`, `packages/schema/src/file-diff.ts`, `packages/plugin/src/promise/tool.ts`, `packages/plugin/src/effect/tool.ts`

Method note: nothing here was run against a live Provider. Claims marked "likely", "unverified" or "unknown" were not confirmed from a primary source.
