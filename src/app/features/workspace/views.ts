import type { TerminalId } from '../../../shared/terminal/terminal.model';
import type { ViewId } from '../../../shared/workspace/workspace.model';

/**
 * The Views a Pane can hold (GLOSSARY: View), named by a `ViewId`: a closed union whose only kind for now is a
 * Terminal. A new kind of View joins `ViewId` and gets a case here; the layout rules (`pane-layout.ts`) only compare
 * Views by their key, so they stay as they are.
 */
export type { ViewId } from '../../../shared/workspace/workspace.model';

export const terminalView = (terminalId: TerminalId): ViewId => ({ kind: 'terminal', terminalId });

/** A string that names the View and no other: a Terminal's id for its View. A Pane made for a View is named after it. */
export const viewKey = (view: ViewId): string => {
  switch (view.kind) {
    case 'terminal':
      return view.terminalId;
  }
};

export const sameView = (a: ViewId, b: ViewId): boolean => viewKey(a) === viewKey(b);

/** Where the View is among these, or -1. */
export const indexOfView = (views: ReadonlyArray<ViewId>, view: ViewId): number => views.findIndex((each) => sameView(each, view));

export const hasView = (views: ReadonlyArray<ViewId>, view: ViewId): boolean => indexOfView(views, view) >= 0;

/** The Terminal the View shows; undefined for a View of another kind. */
export const terminalOf = (view: ViewId): TerminalId | undefined => (view.kind === 'terminal' ? view.terminalId : undefined);
