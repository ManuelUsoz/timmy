# Hooks are installed persistently and do nothing outside Timmy

Activating a Provider's Hook in Settings writes it into the Provider's own config (for example `~/.claude/settings.json`, or an OpenCode plugin) instead of passing flags per launch. Every Terminal Timmy starts sets a `TIMMY_TERMINAL_ID` environment variable, and the Hook does nothing when it is absent, so the same CLI run outside Timmy is unaffected. The user chooses which Providers they use first, and only those can be activated.

We rejected per-launch flags: not every CLI has one, and it would make a Terminal behave differently from the same command typed in another shell, whereas a persistent Hook also works for agents the user starts by typing the command. The cost is that Timmy edits files it does not own, so activation must be explicit, reversible from Settings, and must touch only the entries Timmy added.
