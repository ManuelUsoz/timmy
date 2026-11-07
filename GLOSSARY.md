# Glossary

**Project**
A repository on disk that Terminals belong to.

**Terminal**
A shell process hosted by Timmy in a Project's folder, in which the user runs whatever they want, typically a Provider's agent CLI. It is the entity Timmy owns and lists in the Workspace. It is shown in exactly one View, and closing that View's Tab closes it.
_Avoid_: console, agent.

**Provider**
An agent CLI Timmy can host (OpenCode, Claude Code, Codex). The user chooses in Settings which Providers they use. Timmy does not supply or resell models or tokens: the user installs the Provider's own tooling and signs in to it themselves.

**Model vendor**
A company whose models a Provider serves (Anthropic, OpenAI, and so on). A Provider like OpenCode fronts several Model vendors; Claude Code fronts one.
_Avoid_: provider (for a Model vendor).

**Integration**
The only place that knows how to launch a Provider's CLI, activate its Hook and read its state. It declares what its Provider can do. Each Provider that has a Hook has one Hook Integration (a strategy behind one interface), so the code that lists Hooks, receives their reports and sets the Terminal's state never depends on which Provider it is.
_Avoid_: adapter.

**Hook**
The extension point of a Provider through which an Integration learns what that Provider is doing in a Terminal Timmy started. The user activates it per Provider in Settings, and it reports to Timmy through the local channel: a loopback server in main whose address every Terminal Timmy starts receives in its environment.

**Window mode**
How much of Timmy is showing. There are three: Pill, Panel and Expanded. Timmy always starts in Pill. At any time, the user can move to either of the two modes it is not currently in.

**Pill**
The first Window mode: a single bar at the corner of the screen, led by the Mascot, showing the status of the Terminals. Nothing else is shown.

**Panel**
The second Window mode: a surface anchored at the same corner as the Pill, with a rail and the current Terminal beside it. The rail is led by the Mascot with how many Terminals are in each status, then lists every Terminal, those that need the user (Waiting, Error) first and the rest grouped by Project.

**Expanded**
The third Window mode: the Workspace, centered on the screen. The user can maximize it.

**Workspace**
The full navigation shell shown in Expanded: a sidebar with the Projects, every Terminal across them and Settings, and the Tabs of the selected Project.

**Tab**
A named layout of Panes inside a Project. A Project has one or more Tabs; one is shown at a time.
_Avoid_: workspace (for a Tab).

**Pane**
A region of a Tab, made by splitting another Pane to the right or down. It shows one View, or a Stack.
_Avoid_: panel (Panel is a Window mode), split.

**View**
What a Pane shows: a Terminal, a diff or a pull request. Files are never a View; they are read in the Files browser.

**Files browser**
A large modal over the Workspace with the selected Project's folder as a tree on one side and the chosen file, read-only, on the other.

**Stack**
A Pane holding two or three Views, one expanded and the others collapsed to their headers.

**Switcher**
The modal for jumping to any Tab of any Project from the keyboard, most recent first.

**Terminal status**
What a Terminal is doing: Working, Waiting (a live agent is stalled until the user acts), Done (exited cleanly, or its agent's turn ended), Error (exited otherwise) or Idle (not started).
_Avoid_: state (already used for Window mode and the process state).

**Terminal activity**
What a Terminal's output says it is doing while its process is alive: Active (printing), Idle (quiet for a while) or Needs attention (it rang a bell or sent a notification, until the user focuses the Terminal). The output tap in main reads it from the raw output stream, without parsing it into messages; a Hook feeds the same activity: while a Provider's Hook is reporting, its working, waiting for you and done replace what the output says (Active, Needs attention, Idle) for that Terminal, until the Provider's session ends. The output tap is the generic fallback for Terminals without a Hook, and Terminal activity is not the Terminal status.
_Avoid_: state.

**Seen**
A Done or Error Terminal the user has viewed: its content was on screen (Panel or Expanded) when it was already Done or Error, or it became so while on screen. Selecting a Terminal while in Pill does not make it Seen. A Seen Terminal counts as Idle for the Mascot. Working and Waiting are never Seen, and a restarted Terminal starts unseen.

**Mascot**
Timmy's icon, shown large in Pill and Panel. It shows the highest-priority Terminal status across all Projects (Waiting, then Error, Working, Done, Idle) as its color, looks at the cursor wherever it is on screen, and stays subtly alive. When Idle it now and then plays tennis: a racket floats beside it, with no hands, and the body keeps its status color. It rallies against an unseen opponent, its eyes follow the ball, and any other status ends the game at once. It is a Subscriber: it is always on and is not a Channel.

**Notification**
A Source entering a status. It carries the Source and its type. A new Subscriber receives the latest Notification of every Source that still exists, so what a Subscriber shows never depends on having been listening at the moment. It is never the result of an action of the user.

**Source**
The thing a Notification is about. Only the Terminal for now; each kind of Source defines its own types. When a Source ceases to exist (a Terminal is closed) it is retracted, which is not a status.

**Subscriber**
Anything that listens to Notifications. The Mascot and every Channel are Subscribers.

**Channel**
A Subscriber that alerts the user about a Notification in some form (toast, voice, push). The user configures each Channel in Settings: on or off, and for which of Waiting, Done and Error it alerts. A Channel does not alert about a Source that is already on screen.
