---
name: please-test
description: Hand a finished ticket to the developer for manual testing with a checklist (happy path, edge case, error case), then delete the ticket's progress file once the developer approves. Pass a ticket id like NXY-80. Run at the end of /implement.
---

Argument: a Linear identifier (e.g. `NXY-80`). The progress file is `.claude/progress/NXY-<n>.md`. If it does not exist, say so and stop.

## 1. Build the manual checklist

Read the progress file, the ticket's Acceptance criteria and `git diff --stat main...HEAD` (and the diff where needed) so the steps are concrete. Write steps a human can follow in the running app (`npm run dev`): exact clicks/keys/inputs and the exact expected result. Never "verify it works".

The checklist MUST contain at least one item of each kind, tagged:

- `[happy]` the main flow the ticket delivers, end to end.
- `[edge]` a boundary or unusual-but-valid case (limit values, empty input, many items, rapid repeats, reopening the Session, switching model, etc.).
- `[error]` a case that must fail gracefully (invalid input, over a limit, unsupported state); state the exact message or behaviour expected.

Add more items if the ACs need them, each mapped to the AC(s) it covers (`covers AC 2,3`).

## 2. Persist it, then ask

Rewrite the progress file with `Phase: please-test`, `Next: waiting for developer to run the manual checks`, and a `## Manual test` section:

```
## Manual test
- [ ] [happy] <steps> → <expected> (covers AC 1,2)
- [ ] [edge] <steps> → <expected> (covers AC 3)
- [ ] [error] <steps> → <expected> (covers AC 4)
```

Show the same checklist to the developer and ask them to run it and reply `ok` (all pass) or list what failed. STOP; do nothing else in this turn.

## 3. On the developer's answer

- **`ok` / all pass:** delete `.claude/progress/NXY-<n>.md`. Say it is deleted. Do not start another ticket.
- **Failures:** tick the ones that passed, add each failure under `## Open` with what the developer observed, set `Phase: code`, `Next: fix <failure>`. Do NOT delete the file. Offer to fix them through `/implement NXY-<n>` (resume).
- **Ambiguous answer:** ask; never delete on a guess.
