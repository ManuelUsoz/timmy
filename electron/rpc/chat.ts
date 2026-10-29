import { Effect } from 'effect';
import { ChatRpcs } from '../../src/shared/chat/chat.rpc';
import { ChatRpc } from '../chat/chat-rpc';

export const layerChatHandlers = ChatRpcs.toLayer(
  Effect.gen(function* () {
    const chat = yield* ChatRpc;
    return {
      'Chat.capabilities': () => chat.capabilities,
      'Chat.models': () => chat.models,
      'Chat.commands': ({ cwd }) => chat.commands(cwd),
      'Chat.changeAdapter': ({ provider }) => chat.changeAdapter(provider),
      'Chat.startSession': (options) => chat.startSession(options),
      'Chat.send': (message) => chat.send(message),
      'Chat.resolvePermission': ({ sessionId, response }) => chat.resolvePermission(sessionId, response),
      'Chat.answerQuestion': ({ sessionId, response }) => chat.answerQuestion(sessionId, response),
      'Chat.interrupt': ({ sessionId }) => chat.interrupt(sessionId),
      'Chat.closeSession': ({ sessionId }) => chat.closeSession(sessionId),
    };
  }),
);
