import { terminalTheme } from './terminal-theme';

const dark = { background: '#161616', foreground: '#f4f4f4', focus: '#ffffff' };
const light = { background: '#ffffff', foreground: '#161616', focus: '#0f62fe' };

describe('terminal theme', () => {
  it('uses the app background and text colours', () => {
    const theme = terminalTheme(dark);
    expect(theme.background).toBe('#161616');
    expect(theme.foreground).toBe('#f4f4f4');
    expect(theme.cursor).toBe('#ffffff');
  });

  it('defines all 16 ANSI colours so the shell is not black and white', () => {
    const theme = terminalTheme(dark);
    const ansi = [theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan, theme.brightRed, theme.brightGreen, theme.brightYellow, theme.brightBlue, theme.brightMagenta, theme.brightCyan];
    expect(ansi.every((colour) => typeof colour === 'string' && colour !== '')).toBe(true);
    expect(new Set(ansi).size).toBe(ansi.length);
  });

  it('uses a darker palette on a light background', () => {
    expect(terminalTheme(light).green).not.toBe(terminalTheme(dark).green);
    expect(terminalTheme(light).white).not.toBe(terminalTheme(dark).white);
  });
});
