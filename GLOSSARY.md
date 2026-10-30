# Glossary

**Project**
A repository on disk that sessions belong to.

**Session**
A conversation between the user and an agent, within one project. Timmy owns the session and its stored transcript.
_Avoid_: thread, chat.

**Provider Session**
The id by which a provider's SDK knows a Session. One Session maps to exactly one Provider Session.

**Provider**
An LLM vendor Timmy can talk to (Claude, OpenAI, OpenCode, Grok). Timmy supports several.

**Adapter**
The only place that knows a Provider's SDK. It translates between the SDK and Timmy's provider-neutral domain, and declares what its Provider can do.

**Turn**
One user message and the agent's response to it.

**Worktree**
A separate working directory of the project's git repository, checked out on its own git branch.

**Git branch**
A git branch, and nothing else. Never used for Forks.

**Fork**
A Session paired with its own Worktree, created from a parent Session. A Fork has a parent, and the parent may itself be a Fork.
_Avoid_: session branch, thread.

**Same-feature Fork**
A Fork that continues the parent's work. Its Worktree starts from the parent's git branch, and its Session inherits the parent's conversation up to a chosen Turn.

**New-feature Fork**
A Fork that starts unrelated work. The user chooses the base git branch for its Worktree, and its Session starts without the parent's conversation.

**Branch point**
The exact Turn of the parent that a Same-feature Fork inherits up to.

**Base branch**
The git branch a Fork's Worktree was created from, and the one its work is eventually merged back into. For a Same-feature Fork it is the parent's branch; for a New-feature Fork the user chooses it.

**Pending Carry**
A Carry that has been requested but not yet delivered. It is delivered with the target Session's next user message.

**Carry**
A durable record that findings from one Session are to be delivered to another Session with that Session's next user message. Carries are user-triggered, in either direction between a Fork and its parent. Nothing is delivered live.

**Window mode**
How much of Timmy is showing. There are three: Pill, Panel and Expanded. Timmy always starts in Pill. At any time, the user can move to either of the two modes it is not currently in.

**Pill**
The first Window mode: a single bar at the corner of the screen showing the state of the current Session. Nothing else is shown.

**Panel**
The second Window mode: a small surface anchored at the same corner as the Pill, holding the views of the design (Home, Chat, Diff).

**Expanded**
The third Window mode: the Workspace, centered on the screen. The user can maximize it.

**Workspace**
The full navigation shell shown in Expanded: a rail of areas (Chat, Projects, History, Settings), the list of Projects, and the content of the selected Project (its Sessions, terminals and files) next to the open Session.

**Terminal**
A shell in a Project's folder, listed with the Project's Sessions in the Workspace. For now it is only visual: a local entry that lives until the app closes, with no process behind it and nothing stored.

**Ask**
A request from an agent for the user's permission, waiting for an answer. The user can allow or deny it.
_Avoid_: permission prompt, permission request.
