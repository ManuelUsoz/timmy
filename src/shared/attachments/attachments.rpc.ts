import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { AttachmentId, IngestedAttachment } from './attachment.model';
import { AttachmentsError } from './attachments-error.model';

/** Images of a draft message. The renderer sends bytes; main validates, stores and answers with an id. */
export const AttachmentsRpcs = RpcGroup.make(
  /** Checks the magic bytes, stores the image in app data and returns its id. Fails with `UnsupportedType`. */
  Rpc.make('Attachments.add', {
    payload: { bytes: Schema.Uint8Array },
    success: IngestedAttachment,
    error: AttachmentsError,
  }),

  /** Deletes the stored file of a draft Attachment. Unknown ids are ignored. */
  Rpc.make('Attachments.remove', {
    payload: { id: AttachmentId },
    success: Schema.Void,
  }),
);
