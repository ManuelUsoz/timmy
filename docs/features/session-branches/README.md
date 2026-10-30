# Forks (worktree-backed sessions)

Design for Timmy forks, inspired by t3code thread forks (`apps/server/src/orchestration-v2/` in
`~/workspace/learning/t3code`). Terms are defined in `GLOSSARY.md`; the decisions behind this
design are in `docs/adr/0001` to `0003`. This is a design, not a description of existing code.

## Goal

Make git worktrees cheap to use so the user can run several lines of work in parallel, while a human
stays in control of everything that changes git or crosses between sessions.

## Concepts

A **Fork** is a Session paired with its own Worktree and git branch, created from a parent Session.
Forks can nest. There are two kinds:

| Kind              | Worktree starts from            | Conversation                                     |
| ----------------- | ------------------------------- | ------------------------------------------------ |
| Same-feature Fork | the parent's branch, at HEAD    | inherited up to a chosen Turn (the Branch point) |
| New-feature Fork  | a Base branch the user chooses  | fresh; optional parent summary via a Carry       |

Both kinds always get a new git branch, because git does not allow two worktrees on one branch.
The branch name is typed by the user at creation, prefilled from an optional per-project naming
template, validated as a legal ref name, and rejected if it already exists.

## Creating a Fork

Entry point: a "Fork" action on each finished assistant response. A dialog asks for the kind, the
branch name and, for a New-feature Fork, the Base branch (plus an optional "include parent summary"
checkbox, off by default).

Creation is cheap and makes no provider call:

1. Write the Fork row as `Creating`.
2. Create the git branch and Worktree under `userData/worktrees/<project>/<fork>`.
3. Mark the Fork `Active`.

On failure the row is rolled back and the git error is shown. On startup, leftover `Creating` rows
are reconciled: finished if the Worktree exists, removed otherwise. A Same-feature Fork starts from
HEAD only; if the parent has uncommitted files, the dialog says they are not included. Timmy never
stashes or copies them.

The Fork stays in the parent's Project; its Session works in the Worktree path. Forks keep a
`rootSessionId` for cheap tree queries.

## First message in a Fork (lazy provider work)

- Same-feature Fork: if the adapter advertises `fork` (and `forkFromTurn`), the adapter's
  `forkSession` creates the new Provider Session at the Branch point. Otherwise the domain seeds the
  new Session with a summary built from the transcript Timmy already stores.
- New-feature Fork: starts a fresh Provider Session.

Unused Forks therefore cost nothing, and the model is chosen after the Fork exists. Only a finished
Turn can be a Branch point.

## Carries (sessions communicating)

A Carry moves findings between a Fork and its parent, in either direction, when the user asks:
"Send to parent" in a Fork, "Send to fork…" in a parent.

- A Carry is a durable record: `Pending`, `Delivered` or `Superseded`. It is never hidden prompt
  concatenation.
- It is delivered with the target Session's next user message. A "pending carry" chip shows above
  the input until then.
- Range: the source's Turns since the Branch point, or since the last delivered Carry for the same
  pair (a per-pair watermark). The end Turn defaults to the latest finished one and can be changed.
  A New-feature Fork starts from its first Turn.
- Content: a summary of that range plus git facts (branch, commit list, diffstat). No code is
  carried; merging code stays a git action.
- The summary is generated when the target sends its next message, through the target's own adapter
  and model. If that adapter cannot summarize, the Carry falls back to a raw excerpt truncated to a
  token budget.
- Only finished Turns can be sent. A newer pending Carry from the same source to the same target
  supersedes the older one. Pending Carries from different sources are all delivered together.

## Git state and human actions

Live values are read from git on focus and by slow polling: ahead/behind the Base branch,
uncommitted file count, upstream and pushed, merged into the Base branch. Only milestone
transitions are persisted: created, first commit, pushed, merged, removed.

v1 actions, each an explicit click that shows what it will do first:

- open the Worktree in editor, terminal or file explorer
- push the branch
- remove the Worktree (asks for confirmation if there are uncommitted or unmerged changes; the git
  branch is kept unless the user opts to delete it)

When a Fork's branch is detected as merged, Timmy shows a "merged" badge and suggests archiving. It
never archives or removes on its own. If the Worktree disappears outside Timmy, the Fork becomes
`Missing`: the user chooses to recreate it from the branch or drop the record.

Agents inside a Fork keep today's permission prompts, including for `git push`, `git merge` and
`git worktree remove`. There is no special bypass or block.

## Rules

- Forks have a state: `Creating`, `Active`, `Archived`, `Missing`, `Removed`. Archiving keeps the
  transcript.
- A Session with live child Forks cannot be deleted or archived until each child is dealt with.
- Commands on one Session or Fork are serialized per Session id; different Forks run in parallel.
- Provider specifics live only in adapters. Capability flags (`fork`, `forkFromTurn`) decide native
  versus fallback in one domain function.

## Storage

New tables in the existing SQLite store (`electron/sessions/session-repo.ts`, added as a migration):
Forks (parent, root, kind, Branch point, Base branch and commit, git branch, worktree path, state),
Carries (source, target, range, status, delivered-at) and the milestone events.

## v1 build order

1. Fork data model, tables, git worktree service; Same-feature and New-feature creation with the
   branch-name input; Fork tree in the session list.
2. Lazy provider fork: adapter `forkSession` and the summary fallback.
3. Carries in both directions, pending chip and watermark.
4. Git state tracking, milestones, merged detection, open and push actions.

## v2 ideas

1. **Pull requests and merging from Timmy.** Create a PR for a Fork's branch and merge into the Base
   branch, with conflict handling. Needs forge integration and its own design pass.
2. **Live agent-to-agent messaging.** Tools that let a running session message its parent or a Fork.
   Needs answers on interrupting a running Turn, loop prevention and permissions. It would reuse the
   Carry record.
3. **Fork overview.** A graph or board of all Forks across a Project showing their git state and
   pending Carries, for managing many parallel lines of work.
