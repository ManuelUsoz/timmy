---
status: superseded by ADR-0008
---

# Attachments are stored by Timmy to send; the provider transcript is the record

Images the user adds to a message are **Attachments**. Timmy ingests each one in main (the renderer sends bytes through an `Attachments` RPC; main checks the magic bytes, resizes and stores it as a file in app data, and returns an id). `UserMessage` carries `attachments: [{ id }]`, never bytes. The Adapter builds the provider payload from the stored file at send time (for Claude, base64 image blocks in a streaming `SDKUserMessage`), so the domain stays provider-neutral.

The stored file only serves ingest, the live view of a draft, and sending. What was sent is recorded by the provider's own transcript, and that is the source of truth when a Session is reopened: each Adapter's history mapper rebuilds the images from the blocks it recorded, as ADR 0006 does for Mentions. Deleting the app-data file cannot break a reopened Session. A draft Attachment is deleted when removed, and unsent ones are swept on the next start.

Whether images can be sent is declared, not discovered: the SDK's model info carries no vision flag. `AdapterCapabilities` gains `images: boolean`, and `ModelInfo` gains an optional `images` that overrides it per model. An Adapter without images support is never handed Attachments; `Chat.send` fails with a `ChatError` (`reason: 'ImagesUnsupported'`) before any Turn starts.

Alternatives rejected: embedding base64 in Timmy's own transcript (bloats it and duplicates what the provider already records), letting the renderer pass file paths for main to read (breaks the trust rule behind ADR 0006), and asking the SDK whether a model is multimodal (it cannot say).

Cost accepted: the image bytes exist twice, once in app data and once in the provider transcript.
