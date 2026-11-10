import { TabId } from './tabs';
import { byRecency, searchCards } from './switcher-view';

const card = (tab: string) => ({ tabId: TabId.make(tab) });
const visits = (...order: ReadonlyArray<string>) => new Map(order.map((tab, index) => [TabId.make(tab), index + 1]));

describe('Switcher view', () => {
  describe('byRecency', () => {
    it('puts the Tab visited last first, across Projects', () => {
      const cards = [card('timmy-dev'), card('timmy-review'), card('ascua-main')];
      expect(byRecency(cards, visits('timmy-review', 'ascua-main', 'timmy-dev')).map((each) => each.tabId)).toEqual([
        'timmy-dev',
        'ascua-main',
        'timmy-review',
      ]);
    });

    it('leaves Tabs never visited after the visited ones, in the order they were given', () => {
      const cards = [card('a'), card('b'), card('c'), card('d')];
      expect(byRecency(cards, visits('c')).map((each) => each.tabId)).toEqual(['c', 'a', 'b', 'd']);
    });
  });

  describe('searchCards', () => {
    const named = (tab: string, projectName: string, tabName: string, terminalNames: ReadonlyArray<string>) => ({
      tabId: TabId.make(tab),
      projectName,
      tabName,
      terminalNames,
    });
    const cards = [
      named('t1', 'timmy', 'dev', ['shell 1', 'shell 4']),
      named('t2', 'timmy', 'review', ['shell 2']),
      named('a1', 'API de pagos', 'shell 3', ['shell 3']),
    ];
    const ids = (query: string) => searchCards(cards, query).map((each) => each.tabId);

    it('keeps every card, in order, for an empty query', () => {
      expect(ids('  ')).toEqual(['t1', 't2', 'a1']);
    });

    it('matches the Project name, ignoring case and accents', () => {
      expect(ids('PAGOS')).toEqual(['a1']);
      expect(ids('tímmy')).toEqual(['t1', 't2']);
    });

    it('matches the Tab name', () => {
      expect(ids('rev')).toEqual(['t2']);
    });

    it('matches a Terminal of the Tab, so picking it lands on the Tab that holds it', () => {
      expect(ids('SHELL 4')).toEqual(['t1']);
    });

    it('keeps no card when nothing matches', () => {
      expect(ids('nope')).toEqual([]);
    });
  });
});
