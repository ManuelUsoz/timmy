import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { I18n } from '../../core/i18n';
import { mostUrgent } from '../shell/pill-view';
import { ProjectsState } from './projects-state';
import { isCtrlTab, switcherKey, type SwitcherKeyEvent, type SwitcherModel } from './switcher-keys';
import { byRecency, searchCards, type SwitcherCard } from './switcher-view';
import { frontTerminal, tabPath } from './tabs';
import { TabsState } from './tabs-state';
import { TerminalsState } from './terminals-state';

/**
 * The Switcher (GLOSSARY: Switcher): whether it is open, its cards, its search and the selected card. The cards are
 * taken when it opens, so they do not move under the user while they choose. The Workspace hands it every key press
 * (`key`); the dialog (`Switcher`) shows it.
 */
@Injectable({ providedIn: 'root' })
export class SwitcherState {
  private readonly i18n = inject(I18n);
  private readonly projects = inject(ProjectsState);
  private readonly tabs = inject(TabsState);
  private readonly terminals = inject(TerminalsState);
  private readonly router = inject(Router);

  private readonly state = signal<SwitcherModel | undefined>(undefined);
  /** Open while this is defined. */
  readonly model = this.state.asReadonly();
  private readonly cards = signal<ReadonlyArray<SwitcherCard>>([]);
  readonly query = signal('');
  /** The cards shown now: every Tab, most recent first, kept to those that match the search. */
  readonly shown = computed(() => searchCards(this.cards(), this.query()));

  /** Applies a key press. True when the key was the Switcher's, so nothing else should act on it. */
  key(event: SwitcherKeyEvent): boolean {
    const open = this.state();
    // Every key typed into a Terminal comes here: the cards are only gathered for the one press that can open it.
    if (open === undefined && !(event.type === 'keydown' && isCtrlTab(event))) return false;
    const cards = open === undefined ? this.collect() : this.shown();
    const step = switcherKey(open, event, { count: cards.length, typing: this.query().trim() !== '' });
    switch (step.id) {
      case 'ignore':
        return false;
      case 'show':
        if (open === undefined) {
          this.cards.set(cards);
          this.query.set('');
        }
        this.state.set(step.model);
        return true;
      case 'confirm':
        void this.confirm(step.index);
        return true;
      case 'cancel':
        this.close();
        return true;
    }
  }

  /** The user clicked inside, or wants to search: releasing Ctrl no longer confirms. */
  stick(): void {
    this.state.update((model) => (model === undefined ? model : { ...model, sticky: true }));
  }

  search(query: string): void {
    this.query.set(query);
    this.state.update((model) => (model === undefined ? model : { selected: 0, sticky: true }));
  }

  /** Goes to the Tab of the card at this index among those shown, and closes. */
  async confirm(index: number): Promise<void> {
    const card = this.shown()[index];
    this.close(card === undefined);
    if (card !== undefined) await this.router.navigate(card.path);
  }

  /**
   * Whether the keyboard goes back where it was when the dialog goes: yes when it closes without going anywhere; no when
   * it goes to a Tab, whose screen takes the keyboard (the old one would claim the user is on it).
   */
  restoreFocus = true;

  close(restoreFocus = true): void {
    this.restoreFocus = restoreFocus;
    this.state.set(undefined);
    this.cards.set([]);
    this.query.set('');
  }

  /** Every Tab of every Project, most recent first. */
  private collect(): ReadonlyArray<SwitcherCard> {
    const cards = this.projects.all().flatMap((project) =>
      this.tabs.tabsOf(project.projectId).map((tab): SwitcherCard => {
        const layout = this.tabs.layoutOf(tab);
        const terminalNames = tab.terminals.map((terminal) => this.i18n.t('terminals.name', { number: terminal.number }));
        return {
          tabId: tab.id,
          projectId: project.projectId,
          projectName: project.name,
          tabName: tab.name ?? terminalNames[0],
          terminalNames,
          status: mostUrgent(this.tabs.statusesOf(tab)) ?? 'Idle',
          preview: this.terminals.tailOf(frontTerminal(tab, layout).id),
          path: tabPath(tab, layout),
        };
      }),
    );
    return byRecency(cards, this.tabs.visits());
  }
}
