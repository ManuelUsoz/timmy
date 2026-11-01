import { Effect } from 'effect';
import { AttachmentsRpcs } from '../../src/shared/attachments/attachments.rpc';
import { AttachmentStore } from '../attachments/attachment-store';

export const layerAttachmentsHandlers = AttachmentsRpcs.toLayer(
  Effect.gen(function* () {
    const store = yield* AttachmentStore;
    return {
      'Attachments.add': ({ bytes }) => store.add(bytes),
      'Attachments.remove': ({ id }) => store.remove(id),
    };
  }),
);
