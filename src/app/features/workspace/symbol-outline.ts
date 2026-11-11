import { InjectionToken } from '@angular/core';
import { Effect } from 'effect';
import type { SyntaxNode, Tree } from '@lezer/common';
import type { SymbolsId } from './file-language';

/** The chain of declarations that contains a line (1-based), outermost first: `['HandshakeService', 'connect()']`. */
export type Outline = (line: number) => ReadonlyArray<string>;

/**
 * What a language family needs to outline a file: its Lezer parser and its outline table, from a declaration's node
 * name to the symbol it shows (`undefined` for one that is not a symbol, an anonymous function say).
 */
export interface OutlineFamily {
  readonly parse: (content: string, symbols: SymbolsId) => Tree;
  readonly symbols: Readonly<Record<string, (node: SyntaxNode, text: (node: SyntaxNode) => string) => string | undefined>>;
}

/**
 * One lazy chunk per family, with its Lezer parser: only a file whose language has `symbols` loads one. A language
 * gains symbols when someone writes its table (`outline-*.ts`) and a row here.
 */
const families: Readonly<Record<SymbolsId, () => Promise<OutlineFamily>>> = {
  typescript: () => import('./outline-javascript').then((family) => family.javascriptOutline),
  tsx: () => import('./outline-javascript').then((family) => family.javascriptOutline),
  javascript: () => import('./outline-javascript').then((family) => family.javascriptOutline),
  jsx: () => import('./outline-javascript').then((family) => family.javascriptOutline),
  java: () => import('./outline-java').then((family) => family.javaOutline),
};

/** Where each line starts in `content`. */
const lineStarts = (content: string): ReadonlyArray<number> => {
  const starts = [0];
  for (let at = content.indexOf('\n'); at !== -1; at = content.indexOf('\n', at + 1)) starts.push(at + 1);
  return starts;
};

/**
 * Parses `content` once (a few ms for a usual file, about 0.25 s for the largest one parsed) and answers, for any
 * line, the declarations around its last character that is not blank: a lookup walks up from there.
 */
export const outlineOf = async (content: string, symbols: SymbolsId): Promise<Outline> => {
  const family = await families[symbols]();
  const tree = family.parse(content, symbols);
  const starts = lineStarts(content);
  const text = (node: SyntaxNode) => content.slice(node.from, node.to);
  return (line) => {
    const start = starts[Math.min(Math.max(line, 1), starts.length) - 1];
    const end = line < starts.length ? starts[line] - 1 : content.length;
    // The last character that is not blank nor a separator: on `export class A {` it is inside the class, where the
    // first is not, and the `;` of `send(): void;` in an interface is outside the member.
    const last = content.slice(start, end).replace(/[\s;,]+$/, '').length;
    const at = last === 0 ? start : start + last - 1;
    const chain: Array<string> = [];
    for (let node: SyntaxNode | null = tree.resolveInner(at, 1); node !== null; node = node.parent) {
      const symbol = family.symbols[node.name]?.(node, text);
      if (symbol !== undefined) chain.unshift(symbol);
    }
    return chain;
  };
};

/** Outlines source for the Breadcrumb. A file it cannot outline has an empty chain on every line. */
export interface SymbolOutliner {
  readonly outline: (content: string, symbols: SymbolsId) => Effect.Effect<Outline>;
}

const none: Outline = () => [];

/** Lezer in the page, loaded the first time a file with symbols opens; a spec can provide its own. */
export const SYMBOL_OUTLINER = new InjectionToken<SymbolOutliner>('SymbolOutliner', {
  providedIn: 'root',
  factory: () => ({
    outline: (content, symbols) => Effect.tryPromise(() => outlineOf(content, symbols)).pipe(Effect.orElseSucceed(() => none)),
  }),
});
