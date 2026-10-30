# A Fork is a Session plus a Worktree, with git state read live

A Fork pairs a Session with its own git Worktree and its own git branch, named by the user. Fork records live in the SQLite store next to sessions. Git state (ahead/behind, uncommitted files, pushed, merged) is read from git when needed and never mirrored into the database; only milestone transitions (created, first commit, pushed, merged, removed) are persisted, because git cannot tell us those once the Worktree is gone. We rejected a Fork that is only a Session variant (no isolation) and a mirrored git-state cache (it drifts from the source of truth).

## Consequences

- Creation is intent-then-act: the Fork row is written as `Creating`, git runs, then the row becomes `Active`. Leftover `Creating` rows are reconciled on startup.
- A Worktree removed outside Timmy makes the Fork `Missing`; the user chooses to recreate it or drop the record. Timmy never deletes records or unmerged work silently.
- Timmy never pushes, merges or removes on its own. Git-changing actions are explicit user clicks.
- Commands on one Session or Fork are serialized per Session id.
