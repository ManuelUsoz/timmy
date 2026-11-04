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
What a Terminal is doing: Working, Waiting (a live agent is stalled until the user acts), Done (exited cleanly, or its agent's turn ended), Error (exited otherwise) or Idle (not started).
_Avoid_: state (already used for Window mode and the process state).

**Terminal activity**
What a Terminal's output says it is doing while its process is alive: Active (printing), Idle (quiet for a while) or Needs attention (it rang a bell or sent a notification, until the user focuses the Terminal). The output tap in main reads it from the raw output stream, without parsing it into messages; a Hook can later feed the same signals. It is the generic fallback for Terminals without a Hook, and is not the Terminal status.
_Avoid_: state.

**Seen**
A Done or Error Terminal the user has viewed: it was selected while its content was on screen (Panel or Expanded). A Seen Terminal counts as Idle for the Mascot. Working and Waiting are never Seen, and a restarted Terminal starts unseen.

**Mascot**
Timmy's icon, shown large in Pill and Panel. It shows the highest-priority Terminal status across all Projects (Waiting, then Error, Working, Done, Idle) as its color, looks at the cursor wherever it is on screen, and stays subtly alive. It is a Subscriber: it is always on and is not a Channel.

**Notification**
A Source entering a status. It carries the Source and its type. A new Subscriber receives the latest Notification of every Source that still exists, so what a Subscriber shows never depends on having been listening at the moment. It is never the result of an action of the user.

**Source**
The thing a Notification is about. Only the Terminal for now; each kind of Source defines its own types. When a Source ceases to exist (a Terminal is closed) it is retracted, which is not a status.

**Subscriber**
Anything that listens to Notifications. The Mascot and every Channel are Subscribers.

**Channel**
A Subscriber that alerts the user about a Notification in some form (toast, voice, push). The user configures each Channel in Settings: on or off, and for which of Waiting, Done and Error it alerts. A Channel does not alert about a Source that is already on screen.
