import { Effect } from 'effect';
import { TerminalRpcs } from '../../src/shared/terminal/terminal.rpc';
import { OnScreen } from '../notification/on-screen';
import { TerminalService } from '../terminal/terminal-service';

export const layerTerminalHandlers = TerminalRpcs.toLayer(
  Effect.gen(function* () {
    const terminals = yield* TerminalService;
    const onScreen = yield* OnScreen;
    return {
      'Terminal.show': ({ terminalId }) => onScreen.report(terminalId),
      'Terminal.create': ({ cwd, provider }) => terminals.create(cwd, provider).pipe(Effect.map((terminalId) => ({ terminalId }))),
      'Terminal.output': ({ terminalId }) => terminals.output(terminalId),
      'Terminal.activity': () => terminals.activity,
      'Terminal.focus': ({ terminalId }) => terminals.focus(terminalId),
      'Terminal.write': ({ terminalId, data }) => terminals.write(terminalId, data),
      'Terminal.resize': ({ terminalId, cols, rows }) => terminals.resize(terminalId, cols, rows),
      'Terminal.close': ({ terminalId }) => terminals.close(terminalId),
    };
  }),
);
