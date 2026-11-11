import { describe, expect, it } from 'vitest';
import { isAppUrl } from './app-url';

describe('The window may navigate only to the app URL', () => {
  const dev = 'http://localhost:4200/';
  const packaged = 'file:///C:/Program%20Files/Timmy/resources/app/dist/renderer/index.html';

  it('lets the app reload, with or without a fragment', () => {
    expect(isAppUrl('http://localhost:4200/', dev)).toBe(true);
    expect(isAppUrl('http://localhost:4200/#top', dev)).toBe(true);
    expect(isAppUrl(`${packaged}#top`, packaged)).toBe(true);
  });

  it('refuses another page, another origin, any other file and what is not a URL', () => {
    expect(isAppUrl('http://localhost:4200/other', dev)).toBe(false);
    expect(isAppUrl('https://evil.example/', dev)).toBe(false);
    expect(isAppUrl('file:///C:/Users/me/secret.html', packaged)).toBe(false);
    expect(isAppUrl('file://', packaged)).toBe(false);
    expect(isAppUrl('javascript:alert(1)', dev)).toBe(false);
    expect(isAppUrl('not a url', dev)).toBe(false);
  });
});
