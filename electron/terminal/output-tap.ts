import type { ActivityEvent } from './terminal-activity';

/** The signals a raw output stream can give. They are the part of `ActivityEvent` a producer may emit. */
export type TapSignal = Extract<ActivityEvent, 'Output' | 'Attention'>;

export interface OutputTap {
  /** Reads one chunk of a Terminal's output. Sequences may be split across chunks; the tap remembers where it was. */
  readonly scan: (data: string) => ReadonlyArray<TapSignal>;
}

const BEL = '\x07';
const ESC = '\x1b';
/** An OSC longer than this is not a notification: stop collecting it. */
const MAX_OSC = 4096;

/**
 * OSC 9 (iTerm, Windows Terminal), 777;notify (rxvt) and 99 (kitty) carry a notification. OSC 9 followed by a number
 * is a ConEmu command (progress, current folder), not a message.
 */
const isNotification = (osc: string): boolean =>
  /^9;(?![0-9]{1,2}(;|$))/.test(osc) || osc.startsWith('777;notify;') || osc.startsWith('99;');

type Mode = 'text' | 'escape' | 'osc' | 'oscEscape';

/**
 * Looks at raw terminal output for generic signals. It never turns output into messages (ADR 0008) and it does not
 * touch what is rendered: it only reads a copy of the stream.
 */
export const makeOutputTap = (): OutputTap => {
  let mode: Mode = 'text';
  let osc = '';

  return {
    scan: (data) => {
      if (data === '') return [];
      let attention = false;
      const finishOsc = (): void => {
        if (isNotification(osc)) attention = true;
        osc = '';
        mode = 'text';
      };
      for (const char of data) {
        switch (mode) {
          case 'text':
            if (char === BEL) attention = true;
            else if (char === ESC) mode = 'escape';
            break;
          case 'escape':
            if (char === ']') {
              mode = 'osc';
              osc = '';
            } else if (char !== ESC) mode = 'text';
            break;
          case 'osc':
            if (char === BEL) finishOsc();
            else if (char === ESC) mode = 'oscEscape';
            else if (osc.length < MAX_OSC) osc += char;
            else {
              osc = '';
              mode = 'text';
            }
            break;
          case 'oscEscape':
            if (char === '\\') finishOsc();
            else {
              osc = '';
              mode = 'text';
            }
            break;
        }
      }
      return attention ? ['Output', 'Attention'] : ['Output'];
    },
  };
};
