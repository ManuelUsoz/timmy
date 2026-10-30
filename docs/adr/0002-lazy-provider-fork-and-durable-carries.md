# Provider work happens lazily, and cross-session context moves as durable Carries

Creating a Fork does no provider call: only the Worktree, the git branch and database rows. The provider fork or seed summary happens on the Fork's first message, and a Carry's summary is generated when the target Session sends its next message. A Carry is a durable record with explicit status (pending, delivered, superseded), never hidden prompt concatenation. Its range is bounded by a per-pair watermark that moves forward on each delivery. Several pending Carries from different sources are delivered together; this deliberately relaxes t3code, which rejects them.

We chose this over live agent-to-agent messaging, which raises unresolved questions about interrupting a running turn, loops and permissions. Live messaging can be added later without changing the Carry record.

## Consequences

- Unused Forks cost nothing, and the model is chosen after the Fork exists.
- Carries only come from finished Turns, never a running one.
