import { describe, expect, it } from 'vitest';
import { Mention, parseMentions } from './mention.model';

const known = new Map<string, Mention>([
  ['src/a.ts', { path: 'src/a.ts', kind: 'file' }],
  ['mi carpeta/a b.ts', { path: 'mi carpeta/a b.ts', kind: 'file' }],
  ['src', { path: 'src', kind: 'folder' }],
]);
const resolve = (path: string) => known.get(path);

describe('parseMentions', () => {
  it('reads plain and quoted mentions, once each, in order', () => {
    const result = parseMentions('a @src/a.ts b @"mi carpeta/a b.ts" c @src/a.ts @src', resolve);
    expect(result.mentions.map((m) => m.path)).toEqual(['src/a.ts', 'mi carpeta/a b.ts', 'src']);
    expect(result.invalid).toEqual([]);
  });

  it('strips trailing punctuation only when the literal path does not resolve', () => {
    expect(parseMentions('mira @src/a.ts, y @src/a.ts).', resolve).mentions.map((m) => m.path)).toEqual(['src/a.ts']);
    const literal = new Map([['notes.', { path: 'notes.', kind: 'file' as const }]]);
    expect(parseMentions('@notes.', (p) => literal.get(p)).mentions).toEqual([{ path: 'notes.', kind: 'file' }]);
  });

  it('ignores an @ inside a word and reports paths that do not resolve', () => {
    const result = parseMentions('mail me@x.com about @gone.ts!', resolve);
    expect(result.mentions).toEqual([]);
    expect(result.invalid).toEqual(['gone.ts']);
  });
});
