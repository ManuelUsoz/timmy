# Issue tracker: Linear

Issues for this repo live in Linear, team **Nxy** (key `NXY`). Use the Linear MCP tools (`mcp__claude_ai_Linear__*`), not `gh issue`.

## Conventions

- Create an issue: `save_issue` with team `NXY`. Read one: `get_issue` (by identifier, e.g. `NXY-61`). List/search: `list_issues`.
- Comment on an issue: `save_comment`.
- Apply labels: pass label names to `save_issue`. Labels are team-scoped; the triage labels are listed in `docs/agents/triage-labels.md`. Existing type labels: `Bug`, `Feature`, `Improvement`.
- Close/transition: `save_issue` with a status from `list_issue_statuses`.
- Branches are named `feature/nxy-<n>-<slug>` (the Linear identifier lowercased); PRs are opened on GitHub (`ManuelUsoz/timmy`) with `gh` and reference the Linear identifier.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team `NXY`.

## When a skill says "fetch the relevant ticket"

Run `get_issue` with the identifier, and read its comments with `list_comments`.
