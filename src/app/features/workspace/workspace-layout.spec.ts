import { TestBed } from '@angular/core/testing';
import { layoutFor, WorkspaceLayoutState } from './workspace-layout';

describe('layoutFor (Tailwind default breakpoints: lg 1024, xl 1280)', () => {
  it('shows three columns from xl', () => {
    expect(layoutFor(1280, null)).toEqual({ projects: 'expanded', content: 'column' });
    expect(layoutFor(1920, null)).toEqual({ projects: 'expanded', content: 'column' });
  });

  it('collapses Projects to the rail between lg and xl', () => {
    expect(layoutFor(1279, null)).toEqual({ projects: 'collapsed', content: 'column' });
    expect(layoutFor(1024, null)).toEqual({ projects: 'collapsed', content: 'column' });
  });

  it('turns the project content into an overlay below lg', () => {
    expect(layoutFor(1023, null)).toEqual({ projects: 'collapsed', content: 'overlay' });
    expect(layoutFor(800, null)).toEqual({ projects: 'collapsed', content: 'overlay' });
  });

  it('lets a manual collapse win over the automatic one, in both directions', () => {
    expect(layoutFor(1600, 'collapsed').projects).toBe('collapsed');
    expect(layoutFor(1100, 'expanded').projects).toBe('expanded');
    expect(layoutFor(900, 'expanded').projects).toBe('expanded');
  });

  it('never lets the manual choice change where the content goes', () => {
    expect(layoutFor(900, 'expanded').content).toBe('overlay');
    expect(layoutFor(1600, 'collapsed').content).toBe('column');
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
    expect(state.layout().projects).toBe('expanded');
    state.width.set(1100);
    expect(state.layout().projects).toBe('collapsed');
  });

  it('toggling flips what is showing and then sticks through resizes', () => {
    const state = setup(1400);
    state.toggleProjects();
    expect(state.layout().projects).toBe('collapsed');
    state.width.set(1100);
    expect(state.layout().projects).toBe('collapsed');
    state.toggleProjects();
    expect(state.layout().projects).toBe('expanded');
    state.width.set(1500);
    expect(state.layout().projects).toBe('expanded');
  });

  it('expands from the automatic rail when the user asks, and keeps it expanded', () => {
    const state = setup(1100);
    state.toggleProjects();
    expect(state.layout().projects).toBe('expanded');
    state.width.set(1000);
    expect(state.layout().projects).toBe('expanded');
  });

  it('opens and closes the content overlay, and closes it when the content gets a column again', () => {
    const state = setup(900);
    expect(state.contentOpen()).toBe(false);
    state.toggleContent();
    expect(state.contentOpen()).toBe(true);
    state.width.set(1100);
    expect(state.contentOpen()).toBe(false);
  });
});
