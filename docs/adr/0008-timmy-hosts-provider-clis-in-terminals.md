# Timmy hosts Provider CLIs in Terminals; it does not drive their SDKs

Timmy used to be an agent client: Adapters drove each Provider's SDK and Timmy stored the transcript, rendered a Chat, and built Forks and Carries on top of that. We replaced this with Terminals: Timmy runs the Provider's own CLI in a PTY and adds what the CLIs lack, namely awareness of what each Terminal is doing. The CLI owns its conversation, which lives inside its Terminal: Timmy never lists, resumes, renames, deletes or shows it, and keeps no reference to it.

We rejected keeping the SDK-driven Chat alongside Terminals (two surfaces would keep pulling focus) and scraping Terminal output into a simulated chat (TUIs redraw the screen, so it breaks whenever a CLI changes its layout). Timmy owning the transcript is what made Fork, Carry, Mention and Attachment possible; giving it up is deliberate. Timmy will build its own Worktree, Fork and Carry later and will not depend on a Provider for them.

## Consequences

- The chat feature (Adapters, Chat view, composer, Mention, Attachment, Ask) is deleted; it remains in git history. ADRs 0001, 0002, 0003, 0006 and 0007 are superseded.
- Timmy has no concept of a Provider's conversation outside its Terminal. An earlier version of this ADR kept a reference to it (a Session, listed and resumed in a Terminal); that was withdrawn.
- State comes from each Provider's Hook, with a raw output tap (bell, OSC notifications, idle) as a generic fallback for Terminals without one. Output is never parsed into messages.
- Terminals die with the app for now. A background daemon that keeps them alive, notifications, and communication between Terminals are planned and not built.
- Providers in order of support: OpenCode, Claude Code, Codex.
