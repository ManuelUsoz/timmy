import { Effect } from 'effect';
import { TerminalRpcs } from '../../src/shared/terminal/terminal.rpc';
import { TerminalService } from '../terminal/terminal-service';

export const layerTerminalHandlers = TerminalRpcs.toLayer(
  Effect.gen(function* () {
    const terminals = yield* TerminalService;
    return {
      'Terminal.create': ({ cwd }) => terminals.create(cwd).pipe(Effect.map((terminalId) => ({ terminalId }))),
      'Terminal.output': ({ terminalId }) => terminals.output(terminalId),
      'Terminal.write': ({ terminalId, data }) => terminals.write(terminalId, data),
      'Terminal.resize': ({ terminalId, cols, rows }) => terminals.resize(terminalId, cols, rows),
      'Terminal.close': ({ terminalId }) => terminals.close(terminalId),
    };
  }),
);
