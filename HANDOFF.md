# Handoff: images in Chat (NXY-73)

Delete this file once read. It is untracked and not meant to be committed.

## Goal

Users can paste/drop/pick images in the Chat composer, send them to the agent, and see them in the transcript. Full spec: Linear **NXY-73** (read it with `get_issue`). Decisions are in `docs/adr/0007-attachments-stored-for-send-transcript-is-the-record.md`; the term **Attachment** is in `GLOSSARY.md`. Both are uncommitted on `main`'s working tree, now on the branch below.

## Tickets (Linear sub-issues of NXY-73, all `ready-for-agent`)

| Issue | Title | Blocked by |
|---|---|---|
| NXY-74 | Shared modal component | none |
| NXY-75 | Paste a screenshot and send it to Claude | none |
| NXY-76 | Drop and picker, with limits and errors | 75 |
| NXY-77 | Block images on text-only models | 75 |
| NXY-78 | Confirm an image-only send | 74, 75 |
| NXY-79 | See images in the transcript and when reopening a Session | 75 |
| NXY-80 | Clean up orphaned draft images | 75 |
| NXY-81 | Chore: move new-project-dialog onto the shared modal | 74 |

Tracker is Linear only (the user said to skip GitHub issues). Branches are `feature/nxy-<n>-<slug>`; PRs go to GitHub `ManuelUsoz/timmy` and reference the Linear id.

## State of NXY-74 (in progress, branch `feature/nxy-74-shared-modal-component`)

Written, **not yet typechecked or tested** (the last tool call was interrupted by the user):
- `src/app/shared/ui/modal/modal.ts`: `ui-modal`, inputs `heading`, `primaryLabel`, `closeLabel`; outputs `primary`, `closed`; content projected as body. Esc via `host: '(document:keydown.escape)'`, Tab trap on the dialog, initial focus on the primary button (`afterNextRender`), focus restored to the previous `document.activeElement` on destroy (`DestroyRef`).
- `src/app/shared/ui/modal/modal.css`: fixed full-window overlay, `backdrop-filter: blur(6px)`, dialog max 400px.
- `src/app/shared/ui/modal/modal.spec.ts`: dialog semantics, initial focus, primary, close/backdrop/Esc, Tab trap, focus return.
- `src/app/shared/ui/showcase/showcase.ts`: imports `ModalComponent`, adds `modalOpen` signal.

**Still to do for NXY-74:**
1. Append a "Modal" `<section>` to `src/app/shared/ui/showcase/showcase.html` (this append was the rejected command; it is NOT applied). It needs an "Open modal" `uiButton` and an `@if (modalOpen())` `<ui-modal ...>`.
2. Run `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.spec.json --noEmit`, then `npx ng test --watch=false`. Fix failures (the spec's `ComponentFixture` focus/destroy handling is the likeliest trouble).
3. Check the modal looks right (blur, fits the smallest Panel). Commit, PR, with the attribution lines from the system reminder.

## Then, in order

NXY-75 (the tracer bullet, biggest), then 76/77/80/79 in any order, 78 after 74+75, 81 after 74.

## Decisions already made (do not re-ask)

- `AdapterCapabilities.images: boolean`; optional `ModelInfo.images` overrides per model. The SDK has no vision flag.
- `UserMessage.attachments: [{ id }]`, never bytes. New `Attachments` RPC group (`add`, `remove`); main validates magic bytes, accepts PNG/JPEG/GIF/WebP, max 5 per message, longest edge 1568 px, under 5 MB, stores in app data.
- The renderer reads bytes; main never reads a renderer-supplied path.
- Claude adapter: streaming input (`SDKUserMessage`) with text block (omitted if empty) plus base64 image blocks, only when the message has Attachments. Text-only sends keep the string path (`sdkQuery({ prompt: message.text })`).
- History: the Claude history mapper rebuilds images from the recorded transcript's image blocks; an unrestorable block becomes a placeholder.
- New `ChatError` reason `ImagesUnsupported`. Errors are `reason` + `detail` in English; the renderer maps reasons to i18n keys.
- Image-only send asks first in the shared modal: "Send without text?" / "Your message has only images." / "Send anyway" / "Close" (Spanish: "¿Enviar sin texto?", "Tu mensaje solo tiene imágenes.", "Enviar igualmente", "Cerrar"). The chat view/controller owns the `confirmingImageOnly` signal, not `composer-input` (which is only the text field and emits `submitted`; `send()` lives in `chat-controller`). No "don't ask again".
- Pending images survive switching to a text-only model; Send is blocked with a reason.
- Forks/Carries are out of scope (Fork feature does not exist yet).
- Seams for tests: RPC through `makeDesktopTestLayer` with a fake adapter; `ChatView` spec (like `chat-view-files.spec.ts`); extend `claude-agent-sdk-adapter.spec` and `claude-history-mapper.spec`; modal gets its own component spec.

## Repo facts

- i18n: `src/app/core/i18n.ts` + `i18n-dictionaries.ts` (`i18n.t('key')`); all new strings go in every dictionary.
- Electron chat code is in `electron/chat/`; shared types in `src/shared/chat/` (`session.model.ts` has `UserMessage`, `provider.model.ts` has `AdapterCapabilities` and `ModelInfo`).
- `AGENTS.md` has mandatory Effect 4.0.7 rules (no `Error`, `Schema.TaggedError`, `Effect.fn`, no `@effect/platform`).
- Typecheck: `npm run typecheck` (electron), `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.spec.json --noEmit`. Tests: `npx ng test --watch=false`.
- Python is not installed on this machine; use the Edit tool or Node for file edits.
