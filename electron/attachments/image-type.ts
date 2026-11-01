import type { AttachmentMediaType } from '../../src/shared/attachments/attachment.model';

const startsWith = (bytes: Uint8Array, signature: ReadonlyArray<number>, offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte);

/** The image type the bytes start with, by magic bytes; `undefined` when it is not one Timmy accepts. */
export const sniffImageType = (bytes: Uint8Array): AttachmentMediaType | undefined => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return 'image/gif';
  }
  // "RIFF", four size bytes, then "WEBP".
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return undefined;
};

export const extensionOf: Readonly<Record<AttachmentMediaType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
