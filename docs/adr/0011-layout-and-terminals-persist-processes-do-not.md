# The layout and the Terminals persist; their processes and output do not

Each Project's Tabs, their Panes, the order of every Stack, and the Terminals in them (name, Provider or shell, place in the layout) are saved in `timmy.db`. On restart Timmy restores the layout and recreates every Terminal as Idle (not started); the user starts each one. Output from before the restart is gone.

We rejected restoring sessions (respawning processes, replaying scrollback): a respawned agent CLI would run again in a state the user did not choose, and scrollback alone would show output from a process that no longer exists. Saving nothing was also rejected: the layout is the user's workspace and rebuilding it every launch is the cost the Tabs are meant to remove. A Terminal is owned by exactly one View in one Tab, so closing a Tab deletes its Terminals from the store as well as killing their processes.
