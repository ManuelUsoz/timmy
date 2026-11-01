import { Schema } from 'effect';

export const AttachmentId = Schema.String.pipe(Schema.brand('AttachmentId'));
export type AttachmentId = typeof AttachmentId.Type;

/** The image types Timmy accepts. Main decides by magic bytes, never by what the renderer claims. */
export const AttachmentMediaType = Schema.Literals(['image/png', 'image/jpeg', 'image/gif', 'image/webp']).annotate({
  identifier: 'AttachmentMediaType',
});
export type AttachmentMediaType = typeof AttachmentMediaType.Type;

/** An image added to a message. Only the id travels with the message; the bytes stay in main. */
export const Attachment = Schema.Struct({
  id: AttachmentId,
}).annotate({ identifier: 'Attachment' });
export type Attachment = typeof Attachment.Type;

/** What `Attachments.add` answers: the Attachment plus its type, so the renderer can show the stored file. */
export const IngestedAttachment = Schema.Struct({
  id: AttachmentId,
  mediaType: AttachmentMediaType,
}).annotate({ identifier: 'IngestedAttachment' });
export type IngestedAttachment = typeof IngestedAttachment.Type;
