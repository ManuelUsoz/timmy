---
name: to-tickets
description: Break a plan, spec, or the grilled conversation into PR-sized tracer-bullet Linear tickets, each with explicit Boundaries and Limitations. Use after grill-with-docs.
disable-model-invocation: true
model: opus
effort: high
---

Call the Skill tool with "mattpocock-skills:to-tickets" and follow it fully, with these project overrides (they win on conflict):

## Overrides

- **One ticket = one PR = at most 400 changed lines** (added+removed, excluding lockfiles/generated). If a slice cannot fit, split it further or use expand–contract. Put a line estimate on every ticket and say how you'd split if the estimate is over.
- Publish to Linear team `NXY` (see `docs/agents/issue-tracker.md`), native blocking links, label `ready-for-agent`.
- Use `GLOSSARY.md` vocabulary; respect `docs/adr/`. Flag any ticket that contradicts an ADR instead of silently working around it.
- The implementer is a cheaper, lower-effort model. Your job is to remove its need to make design decisions. Every ticket MUST contain, besides What to build / Acceptance criteria / Blocked by:

**Acceptance criteria format (mandatory).** A numbered checkbox list, one criterion per line, e.g. `- [ ] 1. Pasting a PNG shows a thumbnail in the composer`. Each AC must be: (a) observable and testable at the ticket's Test seam, (b) small enough to land as its own commit, (c) independent of later ACs in the list (order them so each can be committed with the suite green). The implementer ticks, tests and commits per AC (`Covers AC <k>`), so vague or compound ACs ("works well", "A and B") are not allowed; split them. Aim for 3-7 ACs per ticket.

Also required:

```
## Boundaries
- In scope: modules/layers/seams this ticket may touch (names, not line numbers)
- Out of scope: neighbouring things it must NOT touch
- Test seam: where tests go, via which interface (e.g. makeDesktopTestLayer)

## Limitations
- Decisions already made (from grilling/ADRs) that the implementer must not revisit
- Forbidden: new dependencies, new RPC domains, public API changes, etc., unless stated
- Stop conditions: when to halt and report instead of improvising

## Size
- Estimated changed lines: N (<= 400)
```

In the quiz step also ask: is every AC a single testable behaviour that can be committed on its own? And: are the Boundaries tight enough that a low-effort model can't wander?
