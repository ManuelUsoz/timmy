# Glossary

**Project**
A repository on disk that Terminals belong to.

**Terminal**
A shell process hosted by Timmy in a Project's folder, in which the user runs whatever they want, typically a Provider's agent CLI. It is the entity Timmy owns and lists in the Workspace.
_Avoid_: console, tab.

**Provider**
An agent CLI Timmy can host (OpenCode, Claude Code, Codex). The user chooses in Settings which Providers they use. Timmy does not supply or resell models or tokens: the user installs the Provider's own tooling and signs in to it themselves.

**Model vendor**
A company whose models a Provider serves (Anthropic, OpenAI, and so on). A Provider like OpenCode fronts several Model vendors; Claude Code fronts one.
_Avoid_: provider (for a Model vendor).

**Integration**
The only place that knows how to launch a Provider's CLI, activate its Hook and read its state. It declares what its Provider can do.
_Avoid_: adapter.

**Hook**
The extension point of a Provider through which an Integration learns what that Provider is doing in a Terminal Timmy started. The user activates it per Provider in Settings.

**Window mode**
How much of Timmy is showing. There are three: Pill, Panel and Expanded. Timmy always starts in Pill. At any time, the user can move to either of the two modes it is not currently in.

**Pill**
The first Window mode: a single bar at the corner of the screen, led by the Mascot, showing the status of the Terminals. Nothing else is shown.

**Panel**
The second Window mode: a small surface anchored at the same corner as the Pill, holding the views of the design (Home, Terminal, Diff).

**Expanded**
The third Window mode: the Workspace, centered on the screen. The user can maximize it.

**Workspace**
The full navigation shell shown in Expanded: a rail of areas (Projects, Settings), the list of Projects, and the content of the selected Project (its Terminals and files).

**Terminal status**
What a Terminal is doing: Working, Waiting (a live agent is stalled until the user acts), Done (exited cleanly), Error (exited otherwise) or Idle (not started).
_Avoid_: state (already used for Window mode and the process state).

**Seen**
A Done or Error Terminal the user has viewed: it was selected while its content was on screen (Panel or Expanded). A Seen Terminal counts as Idle for the Mascot. Working and Waiting are never Seen, and a restarted Terminal starts unseen.

**Mascot**
Timmy's icon, shown large in Pill and Panel. It shows the highest-priority Terminal status across all Projects (Waiting, then Error, Working, Done, Idle) as its color, looks at the cursor wherever it is on screen, and stays subtly alive.
