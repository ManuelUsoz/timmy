import { Injectable, signal } from '@angular/core';
import type { TabId } from './tabs';

/**
 * The Line selection of a File View (GLOSSARY: Line selection): one contiguous range of lines, 1-based and inclusive.
 * `anchor` is the line a shift-click or a drag extends from; it is `start` or `end`.
 */
export interface LineSelection {
  readonly anchor: number;
  readonly start: number;
  readonly end: number;
}

const single = (line: number): LineSelection => ({ anchor: line, start: line, end: line });

/** The range from `anchor` to `line`, whichever comes first. */
export const rangeFrom = (anchor: number, line: number): LineSelection => ({ anchor, start: Math.min(anchor, line), end: Math.max(anchor, line) });

/** A click on a line number: that line alone, or with shift the range from the anchor to it. */
export const clickLine = (current: LineSelection | undefined, line: number, shift: boolean): LineSelection =>
  shift && current !== undefined ? rangeFrom(current.anchor, line) : single(line);

/** Whether `line` is the only selected line: a click on it clears the Line selection. */
export const isOnlyLine = (current: LineSelection | undefined, line: number): boolean => current !== undefined && current.start === line && current.end === line;

/** The selection as a file of `count` lines can hold it: cut at the last line, none when it starts past it. */
export const clampLines = (selection: LineSelection | undefined, count: number): LineSelection | undefined => {
  if (selection === undefined || selection.start > count || selection.end < 1) return undefined;
  const clamp = (line: number) => Math.min(Math.max(line, 1), count);
  return { anchor: clamp(selection.anchor), start: clamp(selection.start), end: clamp(selection.end) };
};

/** `3` or `3-5`: the lines as a path names them. */
export const lineRange = (selection: LineSelection): string => (selection.start === selection.end ? `${selection.start}` : `${selection.start}-${selection.end}`);

/** What Copiar ruta copies: the path in the Project with `/`, plus `:n` or `:start-end` with a Line selection. */
export const pathWithLines = (path: string, selection: LineSelection | undefined): string => (selection === undefined ? path : `${path}:${lineRange(selection)}`);

/** The lines of a text; a final newline does not start another line. */
export const linesOf = (content: string): ReadonlyArray<string> => {
  if (content === '') return [];
  const lines = content.split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
};

/** What Copiar copies: the selected lines exactly as they are in the file, without the newline that ends the last one. */
export const selectedText = (content: string, selection: LineSelection): string =>
  linesOf(content)
    .slice(selection.start - 1, selection.end)
    .join('\n');

/**
 * The Line selection of every open File View, by Tab and file. It lives outside the View so it survives the View leaving
 * the screen (collapsed in a Stack, another Tab shown) and so others can set it (a Path link). It is never saved, and it
 * goes when its File View closes (`TabsState` tells with `retain`).
 */
@Injectable({ providedIn: 'root' })
export class LineSelections {
  private readonly all = signal<ReadonlyMap<TabId, ReadonlyMap<string, LineSelection>>>(new Map());

  of(tab: TabId, path: string): LineSelection | undefined {
    return this.all().get(tab)?.get(path);
  }

  set(tab: TabId, path: string, selection: LineSelection | undefined): void {
    this.all.update((all) => {
      const files = new Map(all.get(tab));
      if (selection === undefined) files.delete(path);
      else files.set(path, selection);
      const next = new Map(all);
      if (files.size === 0) next.delete(tab);
      else next.set(tab, files);
      return next;
    });
  }

  /** Marks lines `start` to `end` of a file: what a jump to a position does. The View shows what its file can hold of it. */
  select(tab: TabId, path: string, start: number, end = start): void {
    this.set(tab, path, rangeFrom(start, end));
  }

  /** Forgets the selections of the Tab's files that are no longer open. */
  retain(tab: TabId, open: ReadonlyArray<string>): void {
    const files = this.all().get(tab);
    if (files === undefined || [...files.keys()].every((path) => open.includes(path))) return;
    this.all.update((all) => {
      const kept = new Map([...files].filter(([path]) => open.includes(path)));
      const next = new Map(all);
      if (kept.size === 0) next.delete(tab);
      else next.set(tab, kept);
      return next;
    });
  }

  /** Forgets the selections of every Tab that is not one of `tabs`. */
  retainTabs(tabs: ReadonlySet<TabId>): void {
    if ([...this.all().keys()].every((tab) => tabs.has(tab))) return;
    this.all.update((all) => new Map([...all].filter(([tab]) => tabs.has(tab))));
  }
}
