---
name: implement
description: Implement ONE Linear ticket as ONE PR (<=400 changed lines) using scout (haiku) and coder (sonnet) subagents. Resumes after an interruption. Pass a ticket id like NXY-80.
disable-model-invocation: true
---

Implement exactly one ticket per run. Argument: a Linear identifier (e.g. `NXY-80`). If missing or ambiguous, ask.

## Progress file

`.claude/progress/NXY-<n>.md` (gitignored). It tracks what REMAINS, never history (git has history). Format, rewritten whole on every update:

```
# NXY-<n>: <title>
Branch: feature/nxy-<n>-<slug>
Phase: scout | code | checks | review | pr | please-test
Next: <one line: the very next action>
## Acceptance criteria
- [ ] 1. <AC text copied from the ticket>
- [x] 2. ...
## Open
- <blockers / decisions pending>
```

## Steps

0. **Resume check.** If the progress file exists: read it, then reconcile with `git status`, `git log main..HEAD` and `git diff --stat main...HEAD` (git wins on conflict; tick any AC whose commit message says `Covers AC <k>`). Check out the recorded branch, report what remains, and jump to the step named by `Phase`. Otherwise start at 1.
1. `get_issue` + `list_comments` for the ticket. State its title. Verify every "Blocked by" ticket is Done and merged into `main`; if not, stop and say which one. Create the progress file from the ticket's Acceptance criteria (every AC a `- [ ]`). If the ticket has no numbered/checkbox ACs, stop and send it back to `/to-tickets`.
2. Branch from up-to-date `main`: `feature/nxy-<n>-<slug>`. Never work on `main`.
3. Spawn **scout** (Agent, `subagent_type: "scout"`) with the ticket text. Use its report as the only exploration; do not re-search yourself. Set `Phase: code`.
4. Spawn **coder** (Agent, `subagent_type: "coder"`) with: the full ticket (Boundaries, Limitations, Acceptance criteria), the scout report, the progress file path, and the 400-line budget. The coder works AC by AC: full checks green, tick, commit citing the AC, simplify. One coder at a time; never parallel coders.
5. Check `git diff --stat main...HEAD` plus working tree:
   - Over 400 changed lines, or coder reports a boundary conflict → STOP. Do not push. Report, and propose splitting the ticket (back to `/to-tickets`).
   - Any AC still unchecked → resume the coder (new run, same file) or report why; do not continue to review.
6. Set `Phase: checks`. Run the full checks yourself (typecheck x3, `npx ng test --watch=false`). Failures go back to coder once with the exact output; a second failure → stop and report.
7. Set `Phase: review`. Call the Skill tool with "code-review". Fix only findings inside the ticket's Boundaries (each fix: checks green, then its own commit); list the rest in the PR body.
8. Set `Phase: pr`. Push and open the PR with `gh` (use the `mattpocock-skills:pr` skill for the body; target `main`; list the ACs covered). Move the Linear issue to In Review.
9. Call the Skill tool with "please-test" and the ticket id. It writes the manual test checklist (happy, edge, error) into the progress file and asks the developer. STOP. Do not start the next ticket. The progress file is deleted only by `please-test`, after the developer says ok.

Update the progress file after every step above, before starting the next one.
