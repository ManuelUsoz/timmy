import type { ITheme } from '@xterm/xterm';

export interface TerminalTokens {
  readonly background: string;
  readonly foreground: string;
  readonly focus: string;
}

const darkAnsi = {
  black: '#262626', red: '#ff8389', green: '#a7f0ba', yellow: '#f1c21b', blue: '#78a9ff', magenta: '#be95ff', cyan: '#3ddbd9', white: '#c6c6c6',
  brightBlack: '#a8a8a8', brightRed: '#ffb3b8', brightGreen: '#42be65', brightYellow: '#fddc69', brightBlue: '#a6c8ff', brightMagenta: '#d4bbff', brightCyan: '#9ef0f0', brightWhite: '#f4f4f4',
} as const;

const lightAnsi = {
  black: '#161616', red: '#da1e28', green: '#198038', yellow: '#8e6a00', blue: '#0043ce', magenta: '#8a3ffc', cyan: '#007d79', white: '#6f6f6f',
  brightBlack: '#525252', brightRed: '#a2191f', brightGreen: '#0e6027', brightYellow: '#684e00', brightBlue: '#002d9c', brightMagenta: '#6929c4', brightCyan: '#005d5d', brightWhite: '#393939',
} as const;

const isDark = (hex: string): boolean => {
  const value = hex.trim().replace('#', '');
  const full = value.length === 3 ? [...value].map((digit) => digit + digit).join('') : value;
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
};

export const terminalTheme = ({ background, foreground, focus }: TerminalTokens): ITheme => ({
  ...(isDark(background) ? darkAnsi : lightAnsi),
  background,
  foreground,
  cursor: focus,
  cursorAccent: background,
  selectionBackground: isDark(background) ? '#393939' : '#c6c6c6',
});
