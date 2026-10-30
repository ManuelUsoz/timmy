# Adapters own native forking; the domain owns the fallback

Timmy supports several providers, so conversation forking is an optional `SdkAdapter` operation (`forkSession` at a Branch point) advertised through `AdapterCapabilities` (`fork`, `forkFromTurn`). The adapter is the only layer that touches provider SDK specifics. When an adapter cannot fork, one domain function seeds the new Session with a summary built from the transcript Timmy already stores, so every provider works. This keeps the native-vs-fallback policy in a single place and keeps provider details out of the domain.

Carry summaries run through the target Session's own adapter and model. If that adapter cannot summarize, the Carry falls back to a raw excerpt of the source Turns, truncated to a token budget.
