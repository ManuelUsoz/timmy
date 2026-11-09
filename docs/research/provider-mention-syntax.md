# How each Provider takes a file or line mention in its prompt

Research for issue #164 (parent map #159). Researched 2026-11-09.

## Question

"Mencionar en el agente" types a file reference into a Terminal's prompt **without pressing Enter** (ADR 0008: Timmy hosts the Provider CLIs in a PTY, so a Mention is text written to the PTY). For Claude Code, Codex and OpenCode:

1. the file mention syntax (`@path`),
2. line ranges (`path:9-14`, `path#L9-14`, ...),
3. quoting a path with spaces on Windows,
4. whether a typed `@path` is resolved by the CLI or is only text,
5. how to tell the Terminal is at a prompt that accepts text (not mid-turn, not on a permission question).

## Sources and how far they can be trusted

| Provider | Primary sources used | Source code available? |
| --- | --- | --- |
| Claude Code | Official docs on `code.claude.com/docs` (common-workflows, interactive-mode, vs-code, terminal-config, hooks, hooks-guide) and the `anthropics/claude-code` issue tracker | No. The repo holds issues, changelog and plugins, not the CLI source. Behaviour not in the docs is **unknown** unless an issue states it, and issue statements are labelled as user reports. |
| Codex | `openai/codex` source at `8703d32` (main, 2026-11-09): `codex-rs/tui/src/bottom_pane/chat_composer.rs`, `bottom_pane/mod.rs`, `bottom_pane/paste_burst.rs`, `clipboard_paste.rs`, `codex-rs/protocol/src/user_input.rs`; the hooks doc on `learn.chatgpt.com/docs/hooks` | Yes |
| OpenCode | `anomalyco/opencode` (the former `sst/opencode`) source at `12a661e` (dev, release v2.2.6): `packages/tui/src/component/prompt/{autocomplete,index}.tsx`, `packages/tui/src/prompt/parse.ts`, and its docs `packages/web/src/content/docs/{tui,server,ide,plugins}.mdx` | Yes |

Third-party blogs were not used as evidence. The official Codex CLI feature page (`developers.openai.com/codex/cli/features`, now redirecting to `learn.chatgpt.com/docs/codex/cli`) does not document `@` at all, so Codex claims come from source.

Versions move fast. Every claim below is true of the versions above; the CLI a user has installed may differ.

## Findings per Provider

### Claude Code

**Syntax.** `@` opens a path autocomplete; `@src/utils/auth.js` includes the file, `@src/components` (or with a trailing slash) lists a directory. Paths "can be relative or absolute". Fuzzy partial names work (`@auth`). Source: [common-workflows, "Reference files and directories"](https://code.claude.com/docs/en/common-workflows), [vs-code, "@-mentions"](https://code.claude.com/docs/en/vs-code), [interactive-mode, "Quick commands"](https://code.claude.com/docs/en/interactive-mode).

**Resolved or only text.** Resolved at submit, from the message text. The docs say `@` includes the file's content "without waiting for Claude to read them", up to the Read tool limit (25,000 tokens; a text file over 256 KB is not included), and that `CLAUDE_CODE_DISABLE_FILE_MENTIONS=1` "stops `@` file and directory references **in your messages** from including content" (common-workflows). That wording describes message text, not a picker step. An open issue about the same mechanism, ["@FILE NAME syntax fails to auto-include files with spaces in filename" (#4012)](https://github.com/anthropics/claude-code/issues/4012), also treats the typed text as what is parsed (the reporter's concern is where the filename ends). I found no statement that a hand-typed `@path` is treated differently from a picked one; **confidence: medium-high**, not verified by running it.

**Line ranges.** Documented only for the IDE: "Press `Option+K` (Mac) / `Alt+K` (Windows/Linux) to also insert an @-mention reference (like `@file.ts#5-10`) into your prompt" ([vs-code](https://code.claude.com/docs/en/vs-code)). The format is `@path#START-END`. Whether the plain CLI parses `#5-10` in a hand-typed `@path#5-10` is **unknown**: the docs do not say, and the feature request ["Support line range syntax in CLI" (#30830)](https://github.com/anthropics/claude-code/issues/30830) was closed as a duplicate, not as done. A related request (#26993) says CLI users have no keybinding to insert `@file#L-L`; it implies the text form is the thing to type but does not confirm the CLI honours it. The `#heading` form for Markdown (`@README.md#installation`) is mentioned in the changelog but undocumented ([#25456](https://github.com/anthropics/claude-code/issues/25456), user report).

**Paths with spaces.** The docs do not cover it (the vs-code page and common-workflows are silent). A user reports that in the CLI `@"My file with spaces"` works and autocompletes, while the desktop app does not support it ([#64932](https://github.com/anthropics/claude-code/issues/64932), user report, closed inactive). Unquoted names end at whitespace (#4012, #34191). Backslash-escaped spaces do not work for permission checks on macOS (#9611, a different code path). **Quoting with double quotes: user-reported, undocumented.** Windows-specific behaviour (backslashes, `C:\`, `\` vs `/` in `@`) is **unknown**; every doc example uses forward slashes.

**Paste.** Pasting more than 800 characters or more than three lines collapses to `[Pasted text #1 +N lines]` ([terminal-config, "Paste large content"](https://code.claude.com/docs/en/terminal-config)). A short one-line mention is not affected. Whether Claude Code enables bracketed paste: **unknown**. Not needed: plain typed bytes work.

**Is the prompt accepting text.**
- Hooks (documented): `UserPromptSubmit` (a prompt was submitted, also on turns Claude starts itself), `PreToolUse`, `PermissionRequest` ("A tool call needs a permission decision", fires when the dialog appears), `Notification` (matchers `permission_prompt`, `idle_prompt`, `elicitation_dialog`, ...), `Stop` ("Claude finishes responding"), `SessionStart`, `SessionEnd` ([hooks](https://code.claude.com/docs/en/hooks)).
- Timing caveat: `Notification` `permission_prompt` fires only after the prompt "has waited about six seconds" and `idle_prompt` about 60 seconds after finishing ([hooks-guide](https://code.claude.com/docs/en/hooks-guide)). So `PermissionRequest` (immediate) is the signal for "a question is open", not `Notification`.
- Typing while a turn runs: the interactive-mode doc describes queued messages ("While you have messages queued, `Up` from the first row instead takes them back"), so the input box accepts text during a turn. It stays as a draft until Enter.
- Typing while a permission dialog is open: whether keystrokes go to the dialog instead of the input box: **unknown** (not documented). Treat it as "does not accept a mention".

### Codex CLI

**Syntax.** `@` opens a fuzzy file search (the crate `codex-rs/file-search`, `ignore` + `nucleo-matcher`, honours `.gitignore`). By default the `@` menu is "unified": it lists plugins, filesystem entries and skills; `mentions_v2` off gives file-only search (`chat_composer.rs`, module doc "Mention Menus"). **Selecting a file does not insert `@`.** `insert_selected_path` replaces the whole `@token` with the bare path, and its comment says: "If the path contains whitespace, wrap it in double quotes ... Avoid adding quotes when the path already contains one". A test asserts `"@src  $HOME"` becomes `"src/main.rs  $HOME"`, and another that `" @ma"` becomes `" src/main.rs "` (trailing space added). So the form Codex itself produces is `src/main.rs ` or `"my dir/a b.rs" `.

**Resolved or only text.** Only text. `UserInput` in `codex-rs/protocol/src/user_input.rs` has variants `Text`, `Image`, `LocalImage`, `Audio`, `LocalAudio`, `Skill`, and `Mention { name, path }`; `Mention`'s doc says the path is "for example `app://<connector-id>` or `plugin://<plugin-name>@<marketplace-name>`", so it is for apps and plugins, not files. A file mention is just the path in the `Text` the model reads; the model then reads the file with its tools. There is no file-content inlining. Selected image files are the exception (`.png` etc. are attached as images, `insert_selected_file_path`). A hand-typed `@src/a.ts` is therefore the same as typing `src/a.ts` as far as the CLI is concerned; the `@` only has an effect on the editing popup while you type.

**Line ranges.** None. The composer and protocol have no line-range concept (searching the repo for it finds only unrelated review/finding structures). `src/a.ts:9-14` is plain text for the model.

**Paths with spaces.** For typed text there is no parsing, so any quoting is only for the model. Codex's own convention is double quotes when the path has whitespace (above). For *pasted* paths, `normalize_pasted_path` (`clipboard_paste.rs`) accepts `"..."` or `'...'`, `file://` URLs, Windows and UNC paths (without shlex, so backslashes survive) and shell-escaped single paths. It matters because **a pasted path to an existing image file is attached as an image** (`handle_paste_image_path`). A mention that is not a bare existing image path is unaffected.

**Typing details that matter for Timmy.**
- The Codex TUI enables bracketed paste (`crossterm::event::EnableBracketedPaste`, `tui.rs`) and, for terminals without it, treats a rapid stream of key events as a paste (`paste_burst.rs`: "notably Windows"; Enter inside a burst becomes a newline, not submit). Writing a short single-line string with no Enter is safe either way.
- Pastes over 1000 characters (`LARGE_PASTE_CHAR_THRESHOLD`) become an atomic `[Pasted Content N chars]` element.
- A first-line value starting with `/` is parsed as a slash command, and `!` starts shell mode. Use project-relative paths; do not start the text with `/` or `!`.
- Enter submits; Tab queues while a task is running (module doc, "Submission and Prompt Expansion").

**Is the prompt accepting text.**
- Source: `BottomPane` keeps a `view_stack`. When it is non-empty (approval overlay, pickers), both `handle_key_event` and `handle_paste` go to the top view, not the composer (`bottom_pane/mod.rs`). So a mention typed during an approval question goes to the overlay, not the prompt.
- While a turn runs and no view is open, the composer accepts text (Tab is the "queue" key).
- Hooks (documented, [hooks](https://learn.chatgpt.com/docs/hooks)): `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest` ("when Codex is about to ask for approval"), `PostToolUse`, `Stop`, `Interrupt`, `SessionEnd`. Hooks live in `hooks.json` or `[hooks]` in `config.toml`, must be reviewed and trusted (`/hooks`), have a `commandWindows` override. This gives working (`UserPromptSubmit`), asking (`PermissionRequest`) and done (`Stop`). Other questions (the `questions` panel, plan-mode user input) have no hook event I could find: **unknown**.

### OpenCode

**Syntax.** `@` does a fuzzy file search in the working directory: "How is auth handled in @packages/functions/src/api/index.ts?" ([tui docs](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/tui.mdx)). Configured references appear as `@alias` and `@alias/`.

**Resolved or only text.** In the TUI, resolved **only when picked from the autocomplete**. `insertPart` in `autocomplete.tsx` inserts `@<name>` plus a virtual extmark and pushes a structured `{ uri, name, mention }` entry into `prompt.files`. On submit, `prompt/index.tsx` sends `data.session.prompt({ text: inputText, files: promptFilesForServer(entry.files, ...), ... })`: the text plus the structured files. Text typed by hand has no extmark and no entry, so it is plain text. The `POST /tui/append-prompt` server endpoint ([server docs](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/server.mdx), "TUI") ends at `input.insertText(evt.data.text)` in the `tui.prompt.append` handler (`prompt/index.tsx`), so it is also plain text. I did not find any server code that scans the user text for `@path` (searches for `resolvePromptParts`, `fileRegex` return nothing); the docs claim "The content of the file is added to the conversation automatically", which in the code corresponds to the picked structured part. Older releases may differ: **unknown**.

**Line ranges.** Yes, `#START-END` or `#START`, in the picker. `parseFileLineRange` (`packages/tui/src/prompt/parse.ts`, with tests) takes the last `#` followed by `^(\d+)(?:-(\d*))?$`. `src/app.ts#12-20` and `src/app.ts#7` parse; `src/app.ts#12-` and `#12-12` give start only; `#bad` is not a range; `report#2026.md` is a file name. A picked range becomes a file part with `?start=12&end=20` on the `file://` URI. The VS Code integration inserts `@File#L37-42` per the [IDE docs](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/ide.mdx), but note that `#L37` is **not** matched by the picker's parser (it needs digits right after `#`); the IDE route builds the structured part itself (`insertFileMention`). So the typed form `@path#12-20` is a range only when the picker accepts it, never when typed raw.

**Paths with spaces.** No quoting. The autocomplete closes as soon as there is whitespace between the trigger and the cursor (`getTextRange(...).match(/\s/)` then `hide()`), and I found no handling of `"`. A path with spaces can only be inserted as a structured mention via the picker. Typed raw, it is plain text anyway. OpenCode itself normalises mention paths to project-relative with `/` separators, even on Windows (`normalizeMentionPath`: `relative.split(path.sep).join("/")`).

**Is the prompt accepting text.**
- Documented plugin events ([plugins docs](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/plugins.mdx)): `session.status`, `session.idle`, `session.error`, `permission.asked`, `permission.replied`, `tool.execute.before/after`, `message.updated`, `tui.prompt.append`. That covers working, asking and done. The exact payload of `session.status` and whether question tool prompts have an event: **unknown**.
- `opencode --port/--hostname` exposes the TUI's server (`/tui/append-prompt`, `/tui/clear-prompt`, `/tui/submit-prompt`), "used by the OpenCode IDE plugins" (server docs). Appending through it never presses Enter. But it inserts into the input regardless of an open dialog (the handler only checks that the input exists), so it needs the same state gate as typing into the PTY.
- Typing into the PTY while a dialog (permission, question, model picker) is open goes to the dialog: **not verified**, assume so.

## Comparison

| | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- |
| File mention | `@path`, relative or absolute (docs) | Picker inserts bare `path` (source); `@` only opens the picker | `@path` via picker (docs, source) |
| Typed `@path` is | Resolved at submit (docs wording, medium-high, not run) | Text only (source) | Text only; resolved only if picked (source) |
| Resolution result | File content inlined (<= 25k tokens, <= 256 KB) | None; model reads via tools | Structured file part sent with the text |
| Line range | IDE form `@file#5-10` documented; typed CLI form **unknown** | None; plain text for the model | `#START-END` / `#START` (source, tested), picker only |
| Spaces in path | `@"a b/c.ts"` user-reported for CLI, undocumented | Double quotes when whitespace (source, by Codex's picker); no parser for typed text | Not supported in `@` token; whitespace closes the picker |
| Windows backslashes | **Unknown**; docs use `/` | Paste normaliser handles them; typed text unparsed | Normalises to `/` itself |
| "Question open" signal | Hook `PermissionRequest` (immediate); `Notification permission_prompt` lags ~6 s | Hook `PermissionRequest`; source: `view_stack` swallows keys and paste | Plugin events `permission.asked` / `permission.replied` |
| "Turn ended" signal | Hook `Stop` | Hook `Stop` | Plugin `session.idle` |
| Text typed during a turn | Accepted into the input box (queue semantics) | Accepted into the composer (Tab queues) | **Unknown** (not verified) |
| Mid-turn pitfalls | Long paste collapses (not a risk here) | Pasted image path attaches an image; leading `/` or `!` | Mention not structured when typed |

## Recommendation: the text Timmy types per Provider

General rules for all three:
- Write one line, no `\r`, `\n`, `ESC` or other control bytes, and no trailing Enter. Plain typed bytes, no bracketed-paste wrapper (not needed; Codex's paste-burst logic and Claude Code's paste collapse are both avoided by a short string).
- Prefer a path **relative to the Project root**, with `/` separators even on Windows (all three docs/sources use `/`; OpenCode normalises to it). Use the absolute path (also with `/`) only when the file is outside the Project, or when the Terminal's working directory is not known to be the Project root. Timmy does not know a CLI's cwd after the user `cd`s: **unknown**, so the quality of a relative path depends on that.
- End with one trailing space so the autocomplete token is closed and the user keeps typing after it. Caveat: Claude Code #34191 (user report) says a space does not terminate the `@` completion in one version; the user sees the menu and can dismiss it with Esc.
- Insert at the cursor, appending to whatever draft is already in the prompt. Do not clear the draft (OpenCode and Codex have clear/append endpoints; Timmy should not use clear).

| Provider | Whole file | Line range | Path with spaces (including Windows) |
| --- | --- | --- | --- |
| Claude Code | `@src/app/a.ts ` | `@src/app/a.ts#9-14 ` (the documented IDE form; the CLI may treat it as text only: verify before relying on it) | `@"src/my dir/a b.ts" ` (user-reported; if unverified, fall back to the same string without `@`: plain text still reads fine to the model) |
| Codex | `src/app/a.ts ` (the form Codex's own picker produces; omit `@` so the popup does not open while typing) | `src/app/a.ts:9-14 ` (no parser; plain text for the model) | `"src/my dir/a b.ts" ` (Codex's own convention) |
| OpenCode | `@src/app/a.ts ` (plain text unless picked) | `@src/app/a.ts#9-14 ` (plain text unless picked, the picker syntax) | `"src/my dir/a b.ts" ` (no `@`: it would open a picker that closes at the first space and give no benefit; the model reads the path as text) |

The honest summary of what a Mention achieves:
- **Claude Code**: probably a real resolved mention for whole files; lines uncertain.
- **Codex**: always just text the model acts on.
- **OpenCode**: just text; only picking from its own menu gives a structured part. If a resolved mention matters for OpenCode, Timmy would need to drive the picker keystrokes or use a future structured route; neither is verified.

## Unknowns and how to resolve them

These need running the CLI in a Terminal; none is answerable from the sources:

1. **Claude Code, typed `@path#5-10`**: does it include only lines 5-10? Check: type `@file.txt#2-3 what is in this?` and look at the "Read file.txt (lines 2-3)" line in the transcript, on Windows and macOS.
2. **Claude Code, `@"a b/c.txt"` on Windows**, and `\` vs `/`.
3. **Claude Code, a Hook-less permission dialog**: do keystrokes typed into the PTY go to the dialog? (decides whether the Mention button must be disabled while Waiting).
4. **OpenCode, text typed during a turn**, and during a question tool prompt.
5. **OpenCode, whether the server expands a hand-typed `@path` in older releases** (v1.x).
6. **Codex, plan-mode or question panels**: no Hook event found.
7. The CLI's actual working directory after the user `cd`s inside the Terminal (affects relative paths for all three).
