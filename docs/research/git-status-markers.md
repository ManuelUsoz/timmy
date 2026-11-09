# Keeping the changed markers current: git status cost and triggers

Research for issue #162 (parent map #159). It also informs the old question of #158 (keeping the tree and the open file current).

Question: the tree marks changed files (M, A, untracked) and counts them from the `git status` of the Project, read in main. Agents change files all the time. What does `git status` cost, what should trigger a re-read, and how do renames, deletes and submodules show up?

Date of the measurements: 2026-11-09. Nothing in the app was changed.

## Short answer

- `git status --porcelain=v2 -z` is cheap enough to run often. On a 21,007-file tree on Windows it takes about 0.18 to 0.25 s with no tuning, and about 0.1 s with `core.fsmonitor` plus `core.untrackedCache`. On Timmy's own 497-file repo it takes 0.06 s. Almost all of the floor is starting `git.exe` (about 55 to 90 ms here).
- `git ls-files --others`, which main already runs for the tree, is the slower call: 0.47 s clean and 2.1 to 2.3 s with a 20,000-file untracked directory in the same tree. Status is cheaper than the call the tree already makes, because it collapses untracked directories.
- `--untracked-files=no` is the only flag that removes the untracked walk, but it also removes the `?` markers, so it is not usable here. `--untracked-files=all` is the expensive one (about 1.8x slower and 20,040 entries instead of 41), so keep the default `normal`.
- Always run it as `git --no-optional-locks status ...`. Without that flag a status run writes under `.git` and would retrigger a watcher on the Project root.
- A recursive `fs.watch` on Windows works and is cheap to set up, but under a burst of writes it drops events (7,072 events for about 20,400 changes), so it can only be a "something changed, re-run status" hint, never a source of truth.
- Cheapest trigger that keeps the markers current: re-run status (debounced, one at a time) on the events Timmy already receives, namely the Provider Hook's `PostToolUse` and `Stop`, plus window focus and sidebar open as the backstop. No watcher is needed to start with. Details and what stays unknown are at the end.

## Environment of the measurements

- Windows 11 Home 10.0.26200, git 2.56.0.windows.2 (`core.autocrlf=true` from the system config), Node v24.22.0.
- Electron 45.1.0 (the version in `package.json`) bundles Node 24.22.1 per `https://electronjs.org/headers/index.json`, so the `fs.watch` results below apply to the app's main process, apart from Electron-specific overhead which was not measured.
- Large tree: a depth-1 clone of `microsoft/vscode`, 21,007 tracked files. `core.longpaths=true` was needed to check it out on Windows.
- Small tree: this repo, 497 tracked files.
- Timing is `spawnSync('git', ...)` from Node, wall clock, 21 to 31 runs per row, min and median reported (scripts were kept outside the repo). Numbers are noisy on this machine (other processes, Defender, file cache): the same command moved between about 190 ms and about 600 ms across runs minutes apart, and the first run after creating files took 0.4 to 1.6 s. Treat the rows as orders of magnitude, and compare only rows from the same pass.

## 1. Cost of `git status --porcelain=v2` on Windows

### Measured

Clean tree (21,007 files). Median of 9 runs, ms:

| Command | Median |
|---|---|
| `ls-files -z --cached --others --exclude-standard --deduplicate` (what main runs today) | 472 |
| `status --porcelain=v2 -z` | 183 |
| `status ... -uno` | 168 |
| `status ... -unormal` | 182 |
| `status ... -uall` | 195 |
| `--no-optional-locks status ...` | 186 |

Dirty tree: the same 21,007 files plus 30 modified, 5 deleted, a staged rename, a staged add, an untracked file, an untracked directory, and an untracked directory holding 20,000 files (400 folders of 50). Output: 41 entries, 5.5 KB in the default mode. Medians over 31 runs, in ms; two passes shown because the machine moves between passes:

| Configuration | Default (`normal`) | `-uno` | `-uall` |
|---|---|---|---|
| No tuning, pass 1 | 191 | 186 | 345 |
| No tuning, pass 2 | 216 | 246 | 341 |
| `core.fsmonitor=true` + `core.untrackedCache=true`, pass 1 | 102 | 88 | 645 |
| same, pass 2 | 122 | 103 | 563 |

For comparison, today's `ls-files` call on the dirty tree took 2,251 ms median (first run 7.8 s, cold).

Other rows:

- `-uall` returns 20,040 entries (536 KB) against 41 (5.5 KB), because it lists every file inside the untracked 20,000-file directory instead of one `? zz-untracked/` line.
- Per-call `git -c core.fsmonitor=true status ...` without writing any repo config also started the daemon and gave 103 ms (default) and 90 ms (`-uno`). In that pass `core.untrackedCache=true` was still set in the repo config, so this is not a clean measurement of fsmonitor alone.
- An earlier pass with fsmonitor alone (no untracked cache) was not faster for the default mode and noisier (median 517 ms against 203 ms) while the daemon warmed up. The docs predict this (see below). An interleaved A/B run that toggled the settings with `-c` on every call was too noisy to use, because each toggle discards the caches, and is not reported.
- Process floor: `git rev-parse HEAD` 73 ms minimum, 91 ms median in the big tree. Status on Timmy's own 497-file repo: 57 ms median, the same as its `ls-files` (53 ms).
- The fsmonitor daemon is one `git.exe` process per working tree, 8.8 MB working set when measured, started automatically by the first status that sees `core.fsmonitor=true`.

### What the docs say about the flags

- `--untracked-files` (`-u`) modes `no`, `normal` (default) and `all`. Quote: "Because it takes extra work to find untracked files in the filesystem, this mode may take some time in a large working tree. Consider enabling untracked cache and split index if supported ... Otherwise you can use `no` to have `git status` return more quickly without showing untracked files." `status.showUntrackedFiles=no` is "the fastest option". Source: https://git-scm.com/docs/git-status
- `core.untrackedCache=true`: "enable the untracked cache feature and only search directories that have been modified since the previous `git status` command ... The untracked cache is stored in the `.git/index` file. The reduced cost of searching for untracked files is offset slightly by the increased size of the index and the cost of keeping it up-to-date." With `core.fsmonitor` too: "This is faster than using just the untracked cache alone ... While the FSMonitor feature can be enabled without the untracked cache, the benefits are greatly reduced in that case." Caches may need "a few `git status` commands" to warm up. Source: https://git-scm.com/docs/git-status
- Optional locks: "By default, `git status` will automatically refresh the index ... When `status` is run in the background, the lock held during the write may conflict with other simultaneous processes, causing them to fail. Scripts running `status` in the background should consider using `git --no-optional-locks status`." `--no-optional-locks` "is equivalent to setting the `GIT_OPTIONAL_LOCKS` to `0`". Sources: https://git-scm.com/docs/git-status and https://git-scm.com/docs/git
- Built-in fsmonitor daemon: "A daemon to watch the working directory for file and directory changes using platform-specific filesystem notification facilities", talks to `git status` over simple IPC "instead of the slower githooks interface", watches "a single working directory", and is started automatically by commands once `core.fsmonitor` is `true`. The page documents Mac OS and Linux details (Unix domain sockets, inotify) and says nothing about Windows or about speed figures. It refuses network-mounted repositories unless `fsmonitor.allowRemote` is set, and "does not currently know about submodules". Source: https://git-scm.com/docs/git-fsmonitor--daemon

### Reading of the numbers

- With default settings, status already costs only 3 to 4 times a bare `git` start on a 21k-file tree. fsmonitor plus the untracked cache about halves it, to roughly the cost of starting git. For a Project the size of this repo the whole question is moot.
- The untracked part is not the cost driver in the default mode: git stops descending a wholly untracked directory once it has found a file in it, so a 20,000-file untracked directory added little (about 190 to 220 ms against 183 ms clean). It becomes expensive only with `-uall`.
- The existing `ls-files` call is the expensive one for the same reason (it lists every untracked file). Whatever the markers feature does, it should not call that more often than today.
- fsmonitor is a repo-level side effect: it adds a daemon process, and the untracked cache it works best with is stored in the user's `.git/index`. `-c core.fsmonitor=true` per call starts the daemon without editing the user's config but still leaves the daemon running. This is a decision for the user, not something to switch on silently. At these sizes it is not needed.

## 2. Trigger options

Common to all: a trigger only decides when to run one status. Run it single-flight (never two at once for a Project), debounce with a trailing delay so a burst becomes one run, and re-run once more if a trigger arrived while it was running.

| Trigger | Cost | How it fails |
|---|---|---|
| Sidebar open or window focus | Zero while idle. One status per focus, 0.06 to 0.25 s. | Stale while the sidebar is open and Timmy keeps focus, which is exactly while an agent works in a Terminal beside it. Good as a backstop, not as the only trigger. |
| Timer | One status per tick regardless of activity. At 2 s that is a git process every 2 s per open Project for as long as the sidebar is open, mostly for nothing. | Latency up to one interval. Wastes work when idle, lags when busy. The worst fit of the four. |
| Watcher on the Project (`fs.watch` recursive) | One kernel handle per Project, set up in 0.5 ms here. Cost scales with write activity, including in ignored folders. | Loses events under bursts, feeds back from git's own writes, no ignore of folders at the OS level. See below. |
| Hook event from a Provider | Zero while idle. A local HTTP post per tool call, which Timmy already receives. | Only sees Providers that have an active Hook, and only changes made by the agent's tools. See below. |

### Node `fs.watch` with `recursive` on Windows

Source for the API: https://nodejs.org/api/fs.html#fswatchfilename-options-listener (read from `doc/api/fs.md`, section `fs.watch`).

What the docs say:

- "On Windows systems, this feature depends on `ReadDirectoryChangesW`." Recursive watching is a single directory watch with subtree on that call (the docs say "implemented by monitoring changes in a directory versus specific files").
- "The `fs.watch` API is not 100% consistent across platforms, and is unavailable in some situations." On Windows "no events will be emitted if the watched directory is moved or renamed. An `EPERM` error is reported when the watched directory is deleted."
- "On most platforms, `'rename'` is emitted whenever a filename appears or disappears in the directory." `filename` "is not always guaranteed to be provided", so code needs a fallback when it is `null`.
- Watching "can be unreliable, and in some cases impossible, on network file systems (NFS, SMB, etc) or host file systems when using virtualization software such as Vagrant or Docker." The polling alternative `fs.watchFile()` "is slower and less reliable".
- An `ignore` option (glob, RegExp or function) exists on the `main` docs. It works on Node 24.22.0 (tested below), the same line Electron 45 ships.

What was measured (Node v24.22.0, Windows, the 21k-file tree plus 20k untracked files):

| Probe | Result |
|---|---|
| `fs.watch(root, { recursive: true })` returns | 0.5 ms |
| Latency of one append to a tracked file | 2.0 to 3.6 ms, event `change`, with the relative path |
| Create a file | `rename` then `change` for the same name |
| Rename a file | two `rename` events, old name and new name |
| Delete a file | one `rename` |
| One `git status` (default) with the watcher on the root | 8 events, all under `.git` (`.git`, `.git\index.lock`, `.git\index`); a second run 4 events (`.git\index.lock`) |
| One `git --no-optional-locks status` | 0 events |
| A separate process writes 1,000 files | 399 events delivered (249 with a file name) |
| A separate process writes 20,000 files in 400 folders | 7,072 events delivered (4,454 with a file name), over 7.8 s |
| Delete of those 20,000 files | 21,198 events |
| The watching process writes 20,000 files itself, with its event loop busy for 10 s | 2 events delivered |
| `ignore: ['.git', '**/.git/**']` or an `ignore` function | the `.git` event is dropped, other events pass |

Consequences:

- Events are lost under load. The last two write rows lose most events (my inference: the kernel's notification buffer overflows and the extra changes are folded into a few events; I did not confirm that mechanism from libuv's source). A watcher therefore cannot be used to apply deltas ("this file was added"). It can only say "something under here changed", after which status must be re-run for the truth. That is also all the markers need.
- Git's own status writes produce events under `.git` (the index lock and index), so a watcher on the root plus a default `git status` is a feedback loop. `--no-optional-locks` avoided this in the test, and `ignore` for `.git` is a second defence.
- The watcher cannot be told to skip `node_modules` at the OS level. The event flood from an install (above, 21k events for 20k files) still reaches the main process, so a filter and the debounce must be there before any status runs.
- Failure modes on top of the above: nothing on a moved or renamed Project folder, `EPERM` on a deleted one, unreliable on network and virtualised file systems.

### Hook event from a Provider

What exists in the repo today (`electron/hooks/claude-code-hook.ts`, GLOSSARY entries Hook and Hook Integration, ADR 0009): the Claude Code Hook, once the user activates it, already posts the JSON of `UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop` and `SessionEnd` to the loopback channel in main, and only when `TIMMY_TERMINAL_ID` is set. So Timmy already hears about every tool call of Claude Code in a Terminal it started. No new Hook entry would be needed to use `PostToolUse` as a trigger.

What Claude Code documents (https://code.claude.com/docs/en/hooks):

- `PostToolUse` input carries `tool_name`, `tool_input` and `tool_response`, for example `Write` with `tool_input.file_path` and `tool_response.filePath`, and `Edit` with `file_path`, `old_string`, `new_string`. Common fields include `session_id` and `cwd`.
- It fires after other tools too, `Bash` included (Bash input is `command`, `description`, `timeout`, `run_in_background`). A shell command such as `sed -i`, `git checkout`, a code generator or `npm install` changes files without any `file_path` in the event. So the event is a "maybe changed" hint, not a list of paths.
- `Stop` fires "when Claude finishes responding", which is the natural point for a last settle read after a turn.
- Matchers filter on `tool_name`. Hooks matching an event "run in parallel". There is also a `FileChanged` event for "a watched file changes on disk", configured by filename matcher; the page text I could read did not describe how it builds its watch list, so I did not evaluate it.

Other Providers (from the Codex and OpenCode docs, which were only partly readable):

- Codex hooks (https://learn.chatgpt.com/docs/hooks, redirected from developers.openai.com/codex/hooks): `PostToolUse` fires for shell commands, `apply_patch` (file edits) and MCP tools, but "Treat tool hooks as a useful guardrail, not a complete enforcement boundary" and "Some specialized tool paths can opt out of the default hook path." Non-managed hooks must be reviewed and trusted before they run.
- OpenCode: the server plugin page (https://opencode.ai/docs/build/plugins/server) shows a tool hook `"execute.after"` and a subscribable event stream; the event list lives in an API schema I could not read, so whether OpenCode reports file edits is not established here.

How it fails: no signal from a Terminal whose Provider has no active Hook, from a Provider that opts a tool path out, from an edit made outside any agent (the user's editor, `git checkout` typed in a shell, a build step), and when the user has not activated the Hook. The hook command is `curl -m 2 ...; exit 0`, so a missed post is silent.

## 3. How renames, deletes and submodules appear

Format source: https://git-scm.com/docs/git-status (porcelain format version 2). Observed on a scratch repo with a submodule, git 2.56.0.windows.2. Run with `-z`, which gives unquoted paths: without `-z` a path such as `ünï cödé.txt` came out quoted and octal-escaped (`"\303\274n\303\257 c\303\266d\303\251.txt"`).

Line kinds: `1` ordinary change, `2` rename or copy, `u` unmerged, `?` untracked, `!` ignored (only with `--ignored`), plus `# ...` header lines with `--branch`. The docs say parsers "should allow for a mixture of the 3 line types in any order" and "should ignore headers they don't recognize." `XY` is "the staged and unstaged XY values ... with unchanged indicated by a '.' rather than a space": X is index against HEAD, Y is worktree against index.

| Situation | What status prints |
|---|---|
| Modified, unstaged | `1 .M N... 100644 100644 100644 <hH> <hI> <path>` |
| Deleted, unstaged | `1 .D N... 100644 100644 000000 ... <path>` |
| Added to the index | `1 A. N... 000000 100644 100644 ... <path>` |
| Staged rename (`git mv`) | `2 R. N... ... R100 <newPath>` then the original path. With `-z` the new path and the original path are two NUL-terminated fields, new path first. Without `-z` they are separated by a TAB. The `R100` is the similarity score. |
| Rename done on disk without `git mv` | Not a rename. It is a `1 .D` line for the old name plus a `? ` line for the new name, even for identical content. Renames are detected only between HEAD and the index. |
| `--no-renames` | The staged rename becomes `1 A.` for the new path and `1 D.` for the old one. Costs nothing measurable. |
| Untracked file | `? <path>` |
| Untracked directory (`normal`) | `? <dir>/` as one line, however many files are inside (my 20,000-file directory was one line). `-uall` lists every file. |
| Untracked nested repository | `? <dir>/`, as one line. |
| Conflicts | `u <XY>` lines with the unmerged codes (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`). Not exercised here. |
| Type change (file to symlink) | `T` in `XY` per the docs. Not exercised here. |

Submodules: the `<sub>` field is `N...` for ordinary entries and `S<c><m><u>` for a submodule, where `c` is `C` if the commit changed, `m` is `M` if it has modified tracked content, `u` is `U` if it has untracked content, and each is `.` otherwise. Observed, all as `1 .M S... 160000 160000 160000 ... vendor/lib`:

| State of the submodule | `<sub>` | Effect of the flag |
|---|---|---|
| Untracked file inside | `S..U` | `--ignore-submodules=untracked`, `dirty` and `all` all drop it; `-uno` also drops the `U` |
| Modified tracked file inside | `S.MU` (with the untracked file also present) | `dirty` and `all` drop the `M` |
| Commit moved (new commit in the submodule) | `SC.U` | still shown under `untracked` and `dirty`, hidden under `all` |

So a submodule always shows as one path with `.M`, never as the files inside. With `--ignore-submodules=all` the line disappears completely. `--ignore-submodules=dirty` keeps the "commit moved" signal and skips the scan of the submodule's worktree. The fsmonitor page notes the daemon "does not currently know about submodules", so events inside them cost performance but cannot make the result wrong.

Consequences for "N con cambios" and the tree (inputs for the not-yet-specified item in #159):

- A collapsed untracked directory is already one entry (`? dir/`) under the default mode, so counting lines counts it as one change, not as its file count. Counting files inside it needs `-uall` (about 1.8x the time here, 20,040 lines for one directory).
- A path that git reports as `? dir/` ends with `/`; a folder marker can be drawn from that without reading the folder.
- A deleted file has no entry on disk. If the tree shows deleted files it must add them from the status lines (the current tree is built from `ls-files`, where a deleted-in-worktree tracked file still appears because the index still lists it, but a staged delete does not).
- A rename done without `git mv` shows as a delete plus an untracked file. Agents usually do this (shell `mv`, or write new file and delete the old), so the common display is "one deleted, one untracked" and not "renamed".
- A submodule is one path. Whether to look inside it is a separate decision from this one.

## Recommendation

Cheapest trigger that keeps the markers current:

1. Read with `git --no-optional-locks status --porcelain=v2 -z` (default `--untracked-files=normal`, no extra tuning). Add `--ignore-submodules=dirty` if submodule worktree scans ever show up in timings.
2. Trigger it, debounced (trailing, about 0.5 to 1 s) and single-flight per Project, from:
   - the Hook's `PostToolUse` and `Stop` events main already receives (any tool, `Bash` included, since shell edits carry no path),
   - sidebar open and window focus as the backstop for edits that no Hook saw (other Providers, the user's editor, shell commands typed by hand).
3. Do not start with a timer, and do not start with a watcher. Revisit a watcher only if there turns out to be a common case where files change with no Hook event and the window stays focused. If it is added: watch the Project root with `ignore` for `.git`, treat every event as "dirty, re-run status", and keep `--no-optional-locks`.
4. Do not turn on `core.fsmonitor` or `core.untrackedCache` from Timmy. They changed 0.2 s to 0.1 s here, they add a daemon and a bigger index to a repo the user owns, and the docs warn of a warm-up period. Mention them in help text for very large Projects at most.

This is the zero-cost-while-idle option: it spends one process of 0.06 to 0.25 s per burst of agent activity, which is below what the tree's current `ls-files` call costs on the same tree.

## What stays unknown

- Cold-cache cost. First runs after creating files were 0.4 to 1.6 s here. I could not drop the Windows file cache, so the cold figure for a Project opened for the first time is not measured.
- Projects far above 21,000 files (monorepos with 100k+), network drives, WSL and dev containers. The docs say fsmonitor and watching are unreliable or refused there; their cost was not measured.
- Whether a big submodule's worktree scan changes the cost. The submodule test used a one-file submodule.
- Whether the Hook's `cwd` and the Project folder always agree (an agent that `cd`s into a subfolder). Mapping through `TIMMY_TERMINAL_ID` to the Terminal's Project avoids the question, but I did not check how the loopback handler identifies the Terminal for a posted event in the current code.
- Whether OpenCode and Codex report file edits reliably enough to rely on their Hook. Codex documents `PostToolUse` for `apply_patch` and shell with a "not a complete enforcement boundary" caveat; the OpenCode event list was not readable. Providers without a Hook rely on focus and sidebar open.
- Event loss of `fs.watch` inside Electron's main process under real `npm install` or build loads (measured only with Node 24.22.0 and synthetic writes), and its CPU cost on the main thread.
- The effect of `core.autocrlf` and line-ending normalisation on false "modified" markers. This machine has `autocrlf=true` and status was stable, but no CRLF-mismatch case was tried.
- Attribution of a change to one agent (a separate research ticket): status says what differs from HEAD or the index, not who changed it.
- Pending decisions this does not make: whether deleted and renamed files get their own look in the tree, and whether the count includes the files inside an untracked directory.

## Sources

- git-status (flags, porcelain v2, untracked cache, optional locks): https://git-scm.com/docs/git-status
- git (`--no-optional-locks`, `GIT_OPTIONAL_LOCKS`): https://git-scm.com/docs/git
- git-fsmonitor--daemon: https://git-scm.com/docs/git-fsmonitor--daemon
- Node.js `fs.watch`, caveats: https://nodejs.org/api/fs.html#fswatchfilename-options-listener
- Electron to Node version map (Electron 45.1.0 = Node 24.22.1): https://electronjs.org/headers/index.json
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Codex hooks: https://learn.chatgpt.com/docs/hooks
- OpenCode server plugins: https://opencode.ai/docs/build/plugins/server
- In this repo: `electron/files/project-files.ts`, `electron/hooks/claude-code-hook.ts`, `GLOSSARY.md`, `docs/adr/0009-hooks-are-installed-persistently-and-inert-outside-timmy.md`
