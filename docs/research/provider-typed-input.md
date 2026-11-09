# How each Provider takes typed multi-line input in its prompt

Research for issue #174 (parent map #170, feeds #177). Researched 2026-11-09. Reuses #164 (`docs/research/provider-mention-syntax.md` on branch `research/provider-mention-syntax`) and re-checks its Codex claims against newer source.

## Question

Delivery types a Message into the Target's prompt (ADR 0008: a Provider's CLI runs in a PTY, so Delivery is bytes written to the PTY; `TerminalService.write` in `electron/terminal/terminal-service.ts` already does that). For Claude Code, Codex and OpenCode:

1. Does a multi-line Message need bracketed paste, or can newlines be typed?
2. Which key submits, and which key queues instead of submitting?
3. What happens to text that arrives mid-turn, or while a permission prompt or question is showing?
4. How do the Hook's Waiting and Done reports relate to "the prompt is ready for input"?

Out of scope here: whether the Message submits or stays in the prompt (that is #177's decision); this note only says which bytes do each.

## Sources and how far they can be trusted

| Provider | Primary sources used | Source code available? |
| --- | --- | --- |
| Claude Code | Official docs on `code.claude.com/docs`: [interactive-mode](https://code.claude.com/docs/en/interactive-mode), [terminal-config](https://code.claude.com/docs/en/terminal-config), [keybindings](https://code.claude.com/docs/en/keybindings), [permissions](https://code.claude.com/docs/en/permissions), [hooks](https://code.claude.com/docs/en/hooks). The `anthropics/claude-code` issue tracker, labelled as user reports. | No. Anything not in the docs is **unknown** unless an issue states it. |
| Codex | `openai/codex` source at `e54a571` (main, 2026-11-09): `codex-rs/tui/src/{tui.rs,keymap.rs}`, `bottom_pane/{mod.rs,chat_composer.rs,paste_burst.rs,approval_overlay.rs}`, `chatwidget/{input_flow.rs,input_queue.rs}`; hooks doc [learn.chatgpt.com/docs/hooks](https://learn.chatgpt.com/docs/hooks) | Yes |
| OpenCode | `anomalyco/opencode` source at `ed0171f` (dev, 2026-11-09): `packages/tui/src/component/prompt/index.tsx`, `packages/tui/src/routes/session/{index,permission}.tsx`, `packages/tui/src/config/keybind.ts`, `packages/schema/src/session-inbox.ts`, `packages/core/src/session/inbox.ts`; docs `packages/web/src/content/docs/{keybinds,plugins,server}.mdx` | Yes |
| Timmy | `electron/hooks/claude-code-hook.ts`, `electron/terminal/terminal-service.ts`, `GLOSSARY.md`, ADRs 0008 to 0010 in this repo | Yes |

Nothing was run: there is no Windows ConPTY harness in this session, so every "does it work through node-pty" question is listed under Unknowns. Third-party posts were not used as evidence. Versions move fast; the Codex source here is newer than the one #164 read (`8703d32`), and `chat_composer.rs` has since been split into a folder.

## Findings per Provider

### Claude Code

**Newline versus submit.** Enter submits. "To add a line break without submitting, press Ctrl+J, or type `\` and then press Enter. Both work in every terminal with no setup." Shift+Enter works only in some terminals ([terminal-config, "Enter multiline prompts"](https://code.claude.com/docs/en/terminal-config)). The default key table agrees: `chat:submit` = Enter, `chat:newline` = Ctrl+J, and "Ctrl+M: Claude Code always receives it as Enter" ([keybindings, Chat actions and Reserved shortcuts](https://code.claude.com/docs/en/keybindings)). Ctrl+J is byte `0x0A`, Ctrl+M is `0x0D`. So a typed stream where lines are joined by `0x0A` and the final submit is `0x0D` matches the documented keys. Whether ConPTY delivers a written `0x0A` to Claude Code as Ctrl+J is **unknown** (see Unknowns).

**Paste.** [interactive-mode, "Multiline input"](https://code.claude.com/docs/en/interactive-mode) lists "Paste mode: Paste directly" as a supported way to enter multiple lines. The docs do not say Claude Code turns on bracketed paste mode (DECSET 2004); the closed source cannot be read. User reports on the tracker describe the failure when a terminal does not wrap a paste in `ESC[200~ ... ESC[201~`: the newlines in the paste are read as Enter and the message submits early or splits ([#73157](https://github.com/anthropics/claude-code/issues/73157), user report, closed as not planned; it cites #40909 and #47658, both auto-closed as stale). That is consistent with Claude Code honouring the markers when they arrive, but it is a user's inference, not a statement from Anthropic. Treat "Claude Code accepts bracketed paste" as **likely, unverified**.

Two documented side effects of a paste ([terminal-config, "Paste large content"](https://code.claude.com/docs/en/terminal-config)):
- More than 800 characters or more than three lines collapse in the input box to `[Pasted text #1 +120 lines]`, "and still sends the full content when you submit".
- On submit, "Claude sees the content behind each `[Pasted text #N]` placeholder marked as text you pasted from somewhere else rather than typed. Claude is told that a paste can contain instructions you didn't write, and to follow instructions inside it only where the message you typed asks it to. In sessions that don't fetch feature flags, pastes aren't marked."
The second point matters for Messages: a Message delivered as a collapsed paste may be treated as data, not as a request, unless typed text next to it asks for action. A Message of three lines or fewer and under 800 characters is not collapsed, and whether it is marked is not documented.

**Submit and queue keys.**
- Enter: "Type a message and press `Enter` while Claude is working. Claude Code queues the message instead of interrupting the turn" ([interactive-mode, "Queue messages while Claude works"](https://code.claude.com/docs/en/interactive-mode)).
- A queued message "is passed to Claude as soon as those tool calls finish, within the same turn"; when the turn ends with messages still queued "they go out without another key press, in the order you typed them".
- `chat:queueSubmit` = Ctrl+X then Enter: "marked to wait its turn: while Claude is working, Claude Code queues it and never interrupts the turn" (v2.1.247 or later; keybindings).
- `chat:sendNow` = Ctrl+Enter or Ctrl+X Ctrl+S sends queued messages immediately and, when only text is being written, can interrupt the turn (v2.1.275 or later). Do not use it for Delivery.
- Esc interrupts the turn and sends what is queued ([interactive-mode](https://code.claude.com/docs/en/interactive-mode)).

**Mid-turn text.** Accepted into the input box and queued on Enter (above). So text that arrives mid-turn is not lost, but Enter mid-turn joins the running turn at its next tool-call boundary: it is not "after Done". Only a Message without Enter, or sent when the turn has ended, avoids that.

**Permission prompt open.** The permission dialog is answered with the `Confirmation` context keys: `confirm:yes` = Enter, `confirm:no` = Esc ([keybindings, Confirmation actions](https://code.claude.com/docs/en/keybindings)). Before v2.1.280 `y` and `n` were also bound by default; since then a bare letter does not answer. "A dialog that shows `y` and `n` as its keys reads those letters itself". So on a current version a typed Message does not answer a dialog, but the **submit key does**: Enter confirms the focused option, which is the first ("Yes") in the documented Bash prompt ([permissions, example prompt](https://code.claude.com/docs/en/permissions); which option has focus when the dialog opens is shown in a screenshot, not stated in text, so treat as likely). Tab opens a comment field on the focused option and "Claude Code keeps the text you typed", so Tab inside a Message would also reach the dialog. Whether printable text typed while a dialog is open lands in the dialog or in the prompt box behind it is **not documented**.

**Hook events relevant to ready for input** ([hooks](https://code.claude.com/docs/en/hooks)):
- `UserPromptSubmit`: "When a prompt is submitted, before Claude processes it. Also fires on turns Claude Code starts on its own."
- `PermissionRequest`: "When a tool call needs a permission decision"; "runs when Claude Code is about to ask you for permission", not for calls allowed without asking.
- `Notification` with matchers `permission_prompt` ("the prompt has waited about six seconds"; "The timer starts when the permission prompt appears, and each keystroke defers it"), `elicitation_dialog` (an MCP form, same six seconds) and `idle_prompt` ("Claude finished responding about 60 seconds ago and you haven't typed since", and only if no background agent is still running).
- `Stop`: "Runs when the main Claude Code agent has finished responding. **Does not run if the stoppage occurred due to a user interrupt.** API errors fire StopFailure instead." The input carries `background_tasks` and `session_crons`, so a hook can tell "session is done" from "paused waiting for background work".
- `StopFailure` ends a turn on an API error; `SessionStart` and `SessionEnd` exist.

### Codex CLI

**Newline versus submit.** `Enter` submits immediately; `Tab` queues while a task is running and submits like Enter when none is ([`chat_composer.rs`, module doc "Submission and Prompt Expansion"](https://github.com/openai/codex/blob/e54a571/codex-rs/tui/src/bottom_pane/chat_composer.rs)). The editor keymap lists `ctrl-j`, `ctrl-m`, `enter`, `shift-enter` and `alt-enter` as `insert_newline` ([`keymap.rs`, defaults](https://github.com/openai/codex/blob/e54a571/codex-rs/tui/src/keymap.rs)), but the composer checks `submit_keys` and `queue_keys` and returns before the key reaches the editor (`handle_key_event` in `chat_composer.rs`), so plain Enter submits and the newline keys that remain are Shift+Enter, Alt+Enter and Ctrl+J. Shift+Enter needs the terminal to report modifiers; `tui.rs` asks for keyboard enhancement flags "so modifiers for keys like Enter are disambiguated". Ctrl+J is the one that does not depend on the terminal.

**Bracketed paste.** Enabled: `set_modes` runs `execute!(stdout(), EnableBracketedPaste)` ([`tui.rs`](https://github.com/openai/codex/blob/e54a571/codex-rs/tui/src/tui.rs)), and a `Paste` event goes to the composer's `handle_paste`, which inserts it including newlines without submitting. Multiline pastes over 1000 characters (`LARGE_PASTE_CHAR_THRESHOLD`) become an atomic placeholder that is expanded on submit (`chat_composer.rs`, `chat_composer/paste_input.rs`). Nothing in the source marks pasted text as untrusted.

**Paste-burst fallback.** Where a terminal does not deliver paste events, `paste_burst.rs` treats a rapid stream of plain keys (8 ms apart, at least 3 characters) as a paste, and, per its module doc, Enter inside a burst is "treated as a newline *inside the paste*, not as "submit the message""; its module doc says this is "notably Windows". The flush idle timeout is 60 ms on Windows and 8 ms elsewhere. Consequence: if Timmy writes a Message as plain characters with an Enter at the end, Codex may classify the whole stream as a burst and turn a final Enter that follows within the 120 ms suppression window (`PASTE_ENTER_SUPPRESS_WINDOW`) into a newline instead of submitting (inferred from the state machine, not run). Submit needs a pause after the text. The behaviour can be turned off with `tui.disable_paste_burst` in config, which Timmy does not control.

**Mid-turn text.** The composer accepts text while a turn runs. Enter then submits **into the running turn** as a steer (`handle_composer_input_result` in `chatwidget/input_flow.rs` submits when `agent_turn_running`; the message goes into `pending_steers`, `chatwidget/input_submission.rs`), and Tab queues it until the turn ends (`queued_user_messages`, `input_queue.rs`). So, unlike Claude Code, plain Enter mid-turn is not queue semantics.

**Approval overlay open: typed text answers it.** This extends #164. `BottomPane` keeps a `view_stack`; when it is not empty, keys and pastes go to the top view and not to the composer (`bottom_pane/mod.rs`, `handle_key_event`, `handle_paste`). The approval overlay then interprets keys: plain `y` approve, `a` approve for session, `p` approve for prefix, `d` deny, `n` or Esc decline, `c` cancel ([`keymap.rs`, approval defaults](https://github.com/openai/codex/blob/e54a571/codex-rs/tui/src/keymap.rs); `try_handle_shortcut` in [`approval_overlay.rs`](https://github.com/openai/codex/blob/e54a571/codex-rs/tui/src/bottom_pane/approval_overlay.rs)), and Enter accepts the highlighted option (the overlay's test `enter_sets_last_selected_index_without_dismissing` expects `Accept`). So **raw typed characters during an approval prompt can approve the command**: a Message containing the letters `y`, `a`, `p`, `d`, `n` or `c` typed while the overlay is open is a sequence of answers. A bracketed paste is different: the view's default `handle_paste` returns `false` and does nothing (`bottom_pane_view.rs`; the approval overlay does not override it). So bracketed paste is the safer wire format for Codex, **if** the paste markers reach the TUI as a `Paste` event (not verified through ConPTY).

**Question panels.** When the model asks a question and the composer is not covered by a view, a paste goes to the expanded `questions` panel (`BottomPane::handle_paste`, the branch "questions.expanded"), so a Message would be typed into the answer. Documented hooks give no event for this state (below).

**Hook events** ([learn.chatgpt.com/docs/hooks](https://learn.chatgpt.com/docs/hooks)): `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest` ("runs when Codex is about to ask for approval, such as a shell escalation or managed-network approval"; not for commands that need no approval), `PostToolUse`, `Stop`, `Interrupt` ("user interrupts an active turn"), `SessionEnd`, plus subagent and compaction events. `Stop` is listed under "During a turn"; its input includes `turn_id`, `last_assistant_message` and `stop_hook_active`. The page documents no event for "waiting on a user question" or for a settings dialog. Unlike Claude Code, Codex has an explicit `Interrupt` event.

### OpenCode

**Newline versus submit.** Enter submits (the textarea's native `onSubmit`, [`prompt/index.tsx`](https://github.com/anomalyco/opencode/blob/ed0171f/packages/tui/src/component/prompt/index.tsx)). Newline keys: "input_newline": `shift+return,ctrl+return,alt+return,ctrl+j` ([keybinds.mdx](https://github.com/anomalyco/opencode/blob/ed0171f/packages/web/src/content/docs/keybinds.mdx), same default in `config/keybind.ts` as `input.newline`). The docs add that "Some terminals don't send modifier keys with Enter by default", so Ctrl+J is again the terminal-independent one.

**Bracketed paste.** Handled explicitly: the textarea's `onPaste` takes `event.bytes`, normalises `\r\n` and `\r` to `\n` ("Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste") and inserts it ([`prompt/index.tsx`, `onPaste` and `pasteInputText`](https://github.com/anomalyco/opencode/blob/ed0171f/packages/tui/src/component/prompt/index.tsx)). A paste of 3 or more lines or over 150 characters collapses to `[Pasted ~N lines]` unless config `prompt.paste` is `"full"`; the placeholder is expanded back to the full text on submit (`expandTrackedPastedText`). A paste whose content is an image path or SVG is attached instead of inserted (`resolvePastedAttachments`). Nothing marks pasted text as untrusted.

**Submit and queue keys.** Two deliveries exist, `"steer"` and `"queue"` (`SessionInbox.Delivery`, [`schema/src/session-inbox.ts`](https://github.com/anomalyco/opencode/blob/ed0171f/packages/schema/src/session-inbox.ts)). Enter submits with `steer`; the `prompt.queue` action, default `<leader>return` with leader `ctrl+x`, submits with `queue` (`config/keybind.ts`). In the inbox, a steer is promoted "at a step boundary mid-work" and a queued input only "at the idle boundary" (`core/src/session/inbox.ts`, `promote`, doc comment on `Promotable`). So like Codex, plain Enter mid-turn joins the running turn; the explicit queue key (Ctrl+X then Enter) waits for idle.

**Permission prompt or question open: the prompt is not there.** In the session route a `Switch` renders exactly one of: the permission prompt, a form (question) prompt, or the normal `Prompt` ([`routes/session/index.tsx`](https://github.com/anomalyco/opencode/blob/ed0171f/packages/tui/src/routes/session/index.tsx), the `Switch` near `PermissionPrompt`). While a permission request is pending the `Prompt` component is not mounted, so typed text goes to the permission prompt. That prompt (`routes/session/permission.tsx`) selects the first option, `once`, by default; binds `left`/`h` and `right`/`l` to move the selection; binds `return` to select it and `escape` to reject. So Enter in a Message sent during a permission request **approves the request once**, and the letters `h` and `l` move the selection. Pasted text has no input to land in, but whether the paste is dropped or sent elsewhere is **not verified**.

**Server-side alternative.** `POST /tui/append-prompt` appends text and `POST /tui/submit-prompt` submits the current prompt ([server.mdx, "TUI"](https://github.com/anomalyco/opencode/blob/ed0171f/packages/web/src/content/docs/server.mdx)). It needs `opencode --port`, bypasses the PTY (so no newline or paste encoding question), and, as #164 found, the handler only checks that the input exists, so it needs the same state gate as typing into the PTY.

**Plugin events** ([plugins.mdx](https://github.com/anomalyco/opencode/blob/ed0171f/packages/web/src/content/docs/plugins.mdx)): `permission.asked`, `permission.replied`, `session.idle`, `session.status`, `session.error`, `tui.prompt.append`, `tool.execute.before/after`, `message.updated`. This covers working, asking and done; the exact `session.status` payload and whether question forms have their own event are **unknown**.

## Comparison

| | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- |
| Submit | Enter (`0x0D`) | Enter | Enter |
| Newline that never submits | Ctrl+J (`0x0A`), or `\` then Enter; documented | Ctrl+J; Shift+Enter/Alt+Enter if the terminal reports modifiers; source | Ctrl+J; Shift/Ctrl/Alt+Enter if reported; docs and source |
| Bracketed paste | Likely used, not documented; a paste of over 3 lines or 800 characters collapses and is **marked as pasted** for the model | Enabled in `tui.rs`; over 1000 characters collapses; burst fallback treats fast plain keys as a paste | Handled in `onPaste` (CR to LF); 3 lines or 150 characters collapses |
| Collapsed paste still sent in full | Yes (docs) | Yes (expanded on submit) | Yes (expanded on submit) |
| Enter mid-turn | Queues; delivered at the next tool-call boundary or at turn end | Steers the running turn | Steers the running turn |
| Explicit "wait for idle" key | Ctrl+X Enter (`chat:queueSubmit`, v2.1.247+) | Tab | Ctrl+X Enter (`prompt.queue`, default leader) |
| Typed text while an approval is open | Not answered by letters on v2.1.280+; **Enter approves**; where printable text lands is undocumented | **Letters `y a p d n c` answer it; Enter approves**; bracketed paste is ignored | Prompt is replaced by the permission prompt; **Enter approves once**; `h`/`l` move the selection |
| "A question is open" signal | Hook `PermissionRequest` (immediate), `Notification permission_prompt` (6 s, deferred by keystrokes), `elicitation_dialog` | Hook `PermissionRequest`; no event for question panels | Plugin `permission.asked` / `.replied`; question form event unknown |
| "Turn ended" signal | Hook `Stop`; **not fired on user interrupt**; `idle_prompt` after 60 s | Hook `Stop`; `Interrupt` fires on user interrupt | Plugin `session.idle` |

## How the Hook's Waiting and Done relate to "the prompt is ready for input"

What Timmy does today (only Claude Code has a Hook Integration; `electron/hooks/claude-code-hook.ts`): it registers `UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop` and `SessionEnd`. The mapping is `UserPromptSubmit` and `PostToolUse` to Working; `Stop` to Done; `Notification` `permission_prompt` or `elicitation_dialog` to Waiting; `Notification` `idle_prompt` to Done; `SessionEnd` to Ended. It does not register `PermissionRequest` or `SessionStart`. GLOSSARY: Waiting is "a live agent is stalled until the user acts", Done is "exited cleanly, or its agent's turn ended". Neither says "the input box is empty and focused".

Done is the nearest signal to ready, but it is necessary, not sufficient:

1. **Done is turn end, not an empty prompt.** The user may have a draft in the input box. Delivery appends to it (the Hook cannot see the draft). None of the three CLIs reports "prompt is empty".
2. **Interrupt leaves no Done in Claude Code.** `Stop` "does not run if the stoppage occurred due to a user interrupt". After Esc or Ctrl+C the CLI is at a ready prompt, but Timmy's state stays at the last Working (`UserPromptSubmit` or `PostToolUse`) until `idle_prompt`, about 60 seconds later. Codex has `Interrupt`, which Timmy would have to map to Done for that Integration. The consequence for Delivery is false "busy", not a wrong delivery.
3. **Waiting is late and incomplete in Claude Code.** `Notification permission_prompt` fires only after the dialog has waited about six seconds, and "each keystroke defers it". During those six seconds Timmy reads Working, so a rule "deliver only on Done" holds; but a Message's own keystrokes, if wrongly delivered, defer the Waiting report. `PermissionRequest` fires immediately but is not registered by Timmy's Hook today.
4. **Dialogs with no event.** Codex question panels and settings views, OpenCode question forms (unverified), Claude Code startup dialogs (folder trust and similar, before any hook fires; no `SessionStart` is registered) can all be open while the last reported status is Done or Idle. Delivery into them can answer them (Codex letters, any Provider's Enter).
5. **Done can precede more work.** Claude Code `Stop` carries `background_tasks` and `session_crons`; `idle_prompt` is suppressed while a background agent runs. A turn ended with background work in flight can start a new turn that fires `UserPromptSubmit` again; a Message delivered in between joins it (Claude Code queue, Codex and OpenCode steer).
6. **Race between the check and the write.** The Hook reports over a local HTTP post with a 2 s timeout, so the status Timmy holds can lag the CLI by a short time; the write is not atomic with the check. This is the "Target stops being an agent between the check and the delivery" edge already listed in the map.

## Recommendation for #177 (inputs, not decisions)

- **Wire format for the body.** Two candidates are supported by primary sources. (a) Bracketed paste: `ESC[200~` body `ESC[201~`, safer against stray key interpretation in Codex (ignored by an approval overlay), handled by Codex and OpenCode in source, likely handled by Claude Code; costs: collapsing placeholders, and Claude Code marks collapsed pastes as pasted text and tells the model to follow instructions in it only if the typed message asks. (b) Typed lines joined with `0x0A` (Ctrl+J), documented in all three; costs: a raw character stream, so Codex's paste-burst logic may reclassify it, and every character is a keystroke that an unexpected dialog would read. Pick after the verification matrix below; both end with a pause and then `0x0D` if the Message is to be submitted. Single-line Messages need neither.
- **Gate.** Deliver only when the Hook says Done (turn ended) and a Terminal has had no output for a short quiet window; never on Working, Waiting or Idle, as the map already says. Done is not proof the prompt is empty or that no dialog is open (points 1, 4, 5 above): the primitive should not press Enter on a Provider that the Hook cannot prove is at a plain prompt unless the user already accepted that risk.
- **Never include `0x0D` (Enter), Tab or Esc inside a body.** Strip or encode them: they are the keys that answer permission dialogs in all three CLIs.
- **Mid-turn.** If #177 allows delivery before Done: Claude Code Enter queues (safe), Codex needs Tab and OpenCode needs Ctrl+X Enter to queue, and plain Enter on those two steers the running turn.
- **Hooks to add to the Integrations if the gate is to be trustworthy:** Claude Code `PermissionRequest`, `SessionStart`; Codex `PermissionRequest`, `Stop`, `Interrupt`; OpenCode `permission.asked`, `session.idle`.

## Unknowns and how to resolve them

Each needs a real run in a node-pty Terminal on Windows (ConPTY) and one other OS:

1. **Does a written `0x0A` reach each CLI as Ctrl+J (newline) and not as Enter?** Check: write `a\nb` without `\r` to each CLI and see whether the prompt holds two lines.
2. **Do `ESC[200~`/`ESC[201~` written to the PTY arrive as a paste in each CLI under ConPTY?** Check: write `ESC[200~a\nb\nc\nd ESC[201~` and see whether it collapses (Claude Code at 4 lines, OpenCode at 3, Codex stays inline under 1000 characters) and whether the prompt did not submit. Codex's `set_modes` calls `execute!(stdout(), EnableBracketedPaste)`; whether `crossterm` on Windows turns that into a real mode through ConPTY is not shown by the source read here.
3. **Claude Code: do printable characters typed while a permission dialog is open go to the dialog, to the prompt box behind it, or nowhere?** And which option has focus when it opens.
4. **Is a Claude Code collapsed paste really sent with the "pasted from somewhere else" marker, and does that suppress acting on a Message?** The docs say it depends on a feature-flag fetch. Check by pasting a Message with an instruction and seeing whether the model acts.
5. **Codex: timing.** Does a write of text followed 0 ms, 150 ms or 300 ms later by `\r` submit or become a newline (paste-burst window of 120 ms)?
6. **OpenCode: what a bracketed paste does while the permission prompt is mounted** (dropped or delivered to something), and whether question forms emit a plugin event.
7. **Codex: a hook or other signal for question panels and for settings views.** None found.
8. **Claude Code: what the Terminal status is between process start and the first hook** (no `SessionStart` registered), and whether a folder-trust dialog shows then.
