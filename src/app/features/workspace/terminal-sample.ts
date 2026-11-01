import type { TerminalState } from './terminal-entries';
import { shortPath } from './terminal-view';

/** Colours of a piece of output: the design's green, blue, yellow, red, dim and secondary text. */
export type Ink = 'ok' | 'info' | 'warn' | 'err' | 'dim' | 'sub';
export interface Piece {
  readonly text: string;
  readonly ink?: Ink;
}
export type OutputLine = ReadonlyArray<Piece>;

/** The exit code the failure artboard shows. */
export const SAMPLE_EXIT_CODE = 1;

const plain = (text: string, ink?: Ink): OutputLine => [{ text, ink }];
const blank: OutputLine = [];

/**
 * STATIC placeholder output copied from the design artboards. There is no process or PTY behind a terminal yet:
 * this is what the future feature will replace, not something a real command produced.
 */
export const sampleOutput = (state: TerminalState, cwd: string): ReadonlyArray<OutputLine> => {
  const prompt = (command: string): OutputLine => [{ text: shortPath(cwd), ink: 'info' }, { text: ` $ ${command}` }];
  switch (state) {
    case 'Live':
      return [
        prompt('npm run dev'),
        plain('> timmy@0.0.0 dev', 'dim'),
        plain('> concurrently "ng serve" "electron ."', 'dim'),
        blank,
        [{ text: '[0] ' }, { text: 'OK', ink: 'ok' }, { text: '  Compiled successfully.' }],
        [{ text: '[0] ' }, { text: 'INFO', ink: 'info' }, { text: '  Local: http://localhost:4200/' }],
        [{ text: '[1] ' }, { text: 'OK', ink: 'ok' }, { text: '  Handshake RPC listo' }],
      ];
    case 'Error':
      return [
        prompt('npx ng test --watch=false'),
        plain('Initial chunk files   Names   Raw size', 'dim'),
        blank,
        [{ text: 'FAILED', ink: 'err' }, { text: ' DesktopApi > gets app info' }],
        plain("  Error: Expected { version: '0.0.0' } to equal { version: '0.0.1' }", 'err'),
        plain('      at src/app/core/desktop-api.spec.ts:24:38', 'sub'),
        blank,
        [{ text: '12 passed', ink: 'ok' }, { text: '  ' }, { text: '1 failed', ink: 'err' }, { text: '  ' }, { text: '0 skipped', ink: 'dim' }],
      ];
    case 'Done':
    case 'Idle':
      return [prompt('')];
  }
};
