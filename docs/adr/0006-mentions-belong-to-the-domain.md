# Mentions belong to the domain; Adapters translate them

Timmy supports several providers, so `@` mentions of files and folders are a Timmy feature, not a provider one. Timmy defines the `@path` syntax, parses it, and checks that each path exists inside the Session's `cwd`. `UserMessage` carries the text plus the resolved `mentions` (path, file or folder); the old `files: string[]` is removed. The Adapter never parses text: it only translates `mentions` into whatever its provider understands.

`AdapterCapabilities` gains `mentions: 'native' | 'none'`. Claude is `'native'` and keeps passing `@path` through to its SDK. For `'none'`, the domain expands each Mention into the outgoing prompt: files up to 64 KB whole and larger ones truncated with a note, folders as a listing of their files, and a 256 KB cap per message with a visible warning when anything is cut. Other providers start as `'none'` until their Adapter implements native handling. This is the same native-vs-fallback split as ADR 0003.

A Mention that does not resolve (the path is gone, absolute, outside the `cwd`, or not in the git-listed set, so ignored files such as `.env` cannot be mentioned) fails the send: `Chat.send` ends with a `ChatError` (`reason: 'InvalidMention'`, `detail` listing the offending paths) before any Turn starts. The message is not sent and the Session stays open. The composer keeps the draft so the user can fix it.

When a Session is reopened, each Adapter's history mapper returns the user's original text, not the expanded prompt the provider recorded. Mentions are shown as chips derived from that text, so the UI only ever sees `@path`.

Alternatives rejected: always inlining file contents for every provider (burns context, goes stale, and loses the agent's ability to read on demand), and sending only `@path` as text (fails for providers without tool calls and validates nothing).

**Amendment (NXY-69):** a Mention now references a file only. Folders are no longer mentionable: `Mention` is just `{ path }`, a path that is a folder fails as `InvalidMention`, and the `'none'` expansion no longer renders folder listings. The rest of this decision stands.
