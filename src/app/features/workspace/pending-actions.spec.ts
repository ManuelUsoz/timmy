import { TestBed } from '@angular/core/testing';
import { I18n } from '../../core/i18n';
import { sampleFiles } from './files-sample';
import { ChatHeaderActions } from './chat-header-actions';

describe('sampleFiles', () => {
  it('has the design nodes: open folders, a dimmed node_modules and a modified file', () => {
    const tree = sampleFiles('Modificado');
    expect(tree.map((node) => node.label)).toEqual(['src', 'electron', 'node_modules', 'CLAUDE.md', 'package.json']);
    expect(tree.find((node) => node.label === 'node_modules')?.dimmed).toBe(true);
    expect(tree.find((node) => node.label === 'package.json')?.flag).toEqual({ text: 'M', label: 'Modificado' });
  });

  it('gives every node a unique id', () => {
    const ids: string[] = [];
    const walk = (nodes: ReturnType<typeof sampleFiles>): void => nodes.forEach((n) => (ids.push(n.id), walk(n.children ?? [])));
    walk(sampleFiles('M'));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('ChatHeaderActions', () => {
  it('shows Bifurcar, Ver cambios and Más acciones, focusable and named', async () => {
    await TestBed.configureTestingModule({ imports: [ChatHeaderActions] }).compileComponents();
    TestBed.inject(I18n).language.set('es');
    const fixture = TestBed.createComponent(ChatHeaderActions);
    await fixture.whenStable();
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Bifurcar', 'Ver cambios', 'Más acciones']);
    for (const button of buttons) {
      expect(button.disabled).toBe(false);
      expect(button.tabIndex).toBe(0);
      expect(button.getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('does nothing when pressed', async () => {
    await TestBed.configureTestingModule({ imports: [ChatHeaderActions] }).compileComponents();
    const fixture = TestBed.createComponent(ChatHeaderActions);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const before = el.innerHTML;
    const errors: unknown[] = [];
    window.addEventListener('error', (e) => errors.push(e));
    el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.click());
    await fixture.whenStable();
    expect(el.innerHTML).toBe(before);
    expect(errors).toEqual([]);
  });
});
