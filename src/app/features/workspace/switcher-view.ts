import type { TerminalStatus } from '../../../shared/notification/notification.model';
import type { ProjectId } from '../../../shared/projects/projects.model';
import { normalizeText } from './project-search';
import type { TabId } from './tabs';

/** One Tab of one Project, as the Switcher shows it. */
export interface SwitcherCard extends SearchableCard {
  readonly tabId: TabId;
  readonly projectId: ProjectId;
  /** The highest Terminal status in the Tab. */
  readonly status: TerminalStatus;
  /** The last lines of output of the Tab's focused Terminal. */
  readonly preview: ReadonlyArray<string>;
  /** Where picking the card goes: the Tab as it was left. */
  readonly path: ReadonlyArray<string>;
}

/** The names a card answers to in the search: its Project's, its Tab's and those of the Terminals in it. */
export interface SearchableCard {
  readonly projectName: string;
  readonly tabName: string;
  readonly terminalNames: ReadonlyArray<string>;
}

/**
 * The cards whose Project, Tab or one of whose Terminals contains the query, ignoring case and accents, in the order
 * given. A Terminal's match is its Tab's card: picking it goes to the Tab that holds it. An empty query keeps all.
 */
export const searchCards = <T extends SearchableCard>(cards: ReadonlyArray<T>, query: string): ReadonlyArray<T> => {
  const needle = normalizeText(query.trim());
  if (needle === '') return cards;
  return cards.filter((card) => [card.projectName, card.tabName, ...card.terminalNames].some((name) => normalizeText(name).includes(needle)));
};

/**
 * Most recent first (GLOSSARY: Switcher): the Tabs by the order they were last visited, the latest first. Tabs never
 * visited in this app run follow, in the order given.
 */
export const byRecency = <T extends { readonly tabId: TabId }>(cards: ReadonlyArray<T>, visits: ReadonlyMap<TabId, number>): ReadonlyArray<T> => {
  const visited = cards.filter((card) => visits.has(card.tabId)).sort((a, b) => (visits.get(b.tabId) ?? 0) - (visits.get(a.tabId) ?? 0));
  return [...visited, ...cards.filter((card) => !visits.has(card.tabId))];
};
