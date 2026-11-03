# Tool Calling Test

Created to check write, edit, read and shell tool behavior.

## Checklist

- [x] Create file
- [x] Edit file
- [x] Read file
- [x] Run a shell command

## Notes

This block was added by an `edit` call, not a rewrite.

## Edit log

| Tool   | Target              | Result |
| ------ | ------------------- | ------ |
| glob   | `**/*test*.md`      | found `tool-call-test.md` and `README.tool-calling-test.md` |
| read   | both files          | read   |
| edit   | `tool-call-test.md` | appended this section |
| shell  | `(Get-Content).Count` | 27 lines |

The table above exists so a follow-up edit can add a row without touching the
rest of the file — a small check that edits stay surgical.

## Round 2 (new tool catalog)

The Code Mode catalog changed between rounds, so this section records the same
loop against the new tool set.

| Tool             | Target              | Result |
| ---------------- | ------------------- | ------ |
| read             | `tool-call-test.md` | read current 27 lines |
| edit             | `tool-call-test.md` | appended this section |
| shell            | `(Get-Content).Count` | 42 lines |
| browser.preview  | `tool-call-test.md` | unavailable — no desktop browser connected |

Unchanged between rounds: the file still lives at the repo root and still is not
[`README.md`](./README.md).

