import { TestBed } from '@angular/core/testing';
import { layoutFor, WorkspaceLayoutState } from './workspace-layout';

describe('layoutFor (Tailwind default breakpoints: lg 1024, xl 1280)', () => {
  it('shows three columns from xl', () => {
    expect(layoutFor(1280, null)).toEqual({ sidebar: 'expanded', panes: 'all' });
    expect(layoutFor(1920, null)).toEqual({ sidebar: 'expanded', panes: 'all' });
  });

  it('collapses the sidebar between lg and xl', () => {
    expect(layoutFor(1279, null)).toEqual({ sidebar: 'collapsed', panes: 'all' });
    expect(layoutFor(1024, null)).toEqual({ sidebar: 'collapsed', panes: 'all' });
  });

  it('shows only the focused Pane below lg', () => {
    expect(layoutFor(1023, null)).toEqual({ sidebar: 'collapsed', panes: 'focused' });
    expect(layoutFor(800, null)).toEqual({ sidebar: 'collapsed', panes: 'focused' });
  });

  it('lets a manual collapse win over the automatic one, in both directions', () => {
    expect(layoutFor(1600, 'collapsed').sidebar).toBe('collapsed');
    expect(layoutFor(1100, 'expanded').sidebar).toBe('expanded');
    expect(layoutFor(900, 'expanded').sidebar).toBe('expanded');
  });

  it('never lets the manual choice change how many Panes show', () => {
    expect(layoutFor(900, 'expanded').panes).toBe('focused');
    expect(layoutFor(1600, 'collapsed').panes).toBe('all');
  });
});

describe('WorkspaceLayoutState', () => {
  const setup = (width: number) => {
    const state = TestBed.inject(WorkspaceLayoutState);
    state.width.set(width);
    return state;
  };

  it('follows the width while the user has not chosen', () => {
    const state = setup(1400);
    expect(state.layout().sidebar).toBe('expanded');
    state.width.set(1100);
    expect(state.layout().sidebar).toBe('collapsed');
  });

  it('toggling flips what is showing and then sticks through resizes', () => {
    const state = setup(1400);
    state.toggleSidebar();
    expect(state.layout().sidebar).toBe('collapsed');
    state.width.set(1100);
    expect(state.layout().sidebar).toBe('collapsed');
    state.toggleSidebar();
    expect(state.layout().sidebar).toBe('expanded');
    state.width.set(1500);
    expect(state.layout().sidebar).toBe('expanded');
  });

  it('expands the automatically collapsed sidebar when the user asks, and keeps it expanded', () => {
    const state = setup(1100);
    state.toggleSidebar();
    expect(state.layout().sidebar).toBe('expanded');
    state.width.set(1000);
    expect(state.layout().sidebar).toBe('expanded');
  });
});
