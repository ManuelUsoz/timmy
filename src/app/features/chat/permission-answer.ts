import type { PermissionRequest, PermissionResponse } from '../../../shared/chat/permission.model';

/** Maps the ask row's Allow/Deny to the request's matching option; Deny falls back to Cancelled. */
export const permissionAnswer = (request: PermissionRequest, decision: 'Allow' | 'Deny'): PermissionResponse => {
  const kinds = decision === 'Allow' ? ['AllowOnce', 'AllowAlways'] : ['RejectOnce', 'RejectAlways'];
  const option = kinds.map((kind) => request.options.find((o) => o.kind === kind)).find((o) => o !== undefined);
  return option === undefined
    ? { _tag: 'Cancelled', requestId: request.id }
    : { _tag: 'Selected', requestId: request.id, optionId: option.id };
};
