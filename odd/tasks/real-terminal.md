# Issue #65 — Real Terminal in the Workspace

Implement the real PTY-backed terminal described by GitHub issue #65.

## Specs

1. **S1 — Shell process and project cwd**
   > "New terminal" in a Project opens a real shell: PowerShell 7 if installed, otherwise Windows PowerShell, in the Project's folder, with a PTY behind it.

2. **S2 — Interactive terminal UI**
   > The Workspace Terminal screen renders it, the user can type, resize the window and close the Terminal, and closing kills the process.

3. **S3 — Multiple ephemeral terminals**
   > Several Terminals can run at once and keep their own output when switching between them.
   > Terminals still die with the app and nothing is stored (ADR 0008).

4. **S4 — IPC boundary**
   > The PTY runs in main and is reached through an RPC group; the renderer never touches Node.

5. **S5 — Packaging and e2e**
   > `npm run package` produces an app in which a Terminal opens.
   > An e2e spec covers the flow with `timmy.shot` baselines for each visual state

## Tasks

- T1 (S1, S4): Add a typed Terminal RPC contract, main-process PTY service, and handlers for create/write/resize/close/output. — commit: f0df828
- T2 (S2, S3): Connect renderer terminal state and screen to the RPC stream with input, resize, switching, and close behavior. — commit: f0df828
- T3 (S5): Add focused service/UI tests and a terminal e2e flow with screenshot checkpoints. — commit: f0df828
- T4 (S5): Add native dependency/build packaging configuration and verify typecheck, tests, e2e, and package. — commit: f0df828

## Log

- L1: tickets from gh issues that has label ready-for-agent
- L2: start with 65
- L3: GitHub issue #65 title: Real Terminal in the Workspace
- L4: The renderer keeps terminal output in memory only; local fallback creation preserves existing UI tests when no live RPC layer is provided.
