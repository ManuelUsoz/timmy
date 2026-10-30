import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PillComponent } from './pill';

@Component({
  imports: [PillComponent],
  template: `
    <ui-pill id="idle" square tone="neutral" label="Idle">Nothing running</ui-pill>
    <ui-pill id="fleet" square tone="running" label="4 live" [subagents]="5" [worktrees]="2">3 projects</ui-pill>
    <ui-pill id="asks" square tone="waiting" label="Asks">
      api-gateway · git push<span pillCounts>+3 live</span><span pillAction>Review</span>
    </ui-pill>
    <ui-pill id="done" square tone="running" label="Done">docs-sweep · 4 files<span pillMeta>+40 −3</span></ui-pill>
  `,
})
class Host {}

describe('PillComponent variants', () => {
  async function render() {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const pill = (id: string) => root.querySelector(`#${id}`) as HTMLElement;
    const button = (id: string) => pill(id).querySelector('button') as HTMLButtonElement;
    const name = (id: string) =>
      (button(id).getAttribute('aria-labelledby') ?? '')
        .split(' ')
        .map((ref) => root.querySelector(`[id="${ref}"]`)?.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    return { pill, button, name };
  }

  it('renders a real button', async () => {
    const { button } = await render();
    expect(button('idle').tagName).toBe('BUTTON');
    expect(button('idle').type).toBe('button');
  });

  it('names the button from state and text', async () => {
    const { name } = await render();
    expect(name('idle')).toBe('Idle Nothing running');
    expect(name('done')).toBe('Done docs-sweep · 4 files +40 −3');
  });

  it('includes counts in the name for the fleet variant', async () => {
    const { name } = await render();
    expect(name('fleet')).toContain('4 live 3 projects');
    expect(name('fleet')).toContain('5 subagents');
    expect(name('fleet')).toContain('2 worktrees');
  });

  it('includes the trailing action in the name', async () => {
    const { name, pill } = await render();
    expect(name('asks')).toBe('Asks api-gateway · git push +3 live Review');
    expect(pill('asks').classList).toContain('as-pill--attn');
  });

  it('hides counts that were not given', async () => {
    const { pill } = await render();
    expect(pill('idle').querySelector('[data-count]')).toBeNull();
    expect(pill('fleet').querySelectorAll('[data-count]').length).toBe(2);
  });

  it('marks the square variant', async () => {
    const { pill } = await render();
    expect(pill('idle').classList).toContain('as-pill--square');
  });
});
