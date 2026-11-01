import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ComposerInputComponent } from './composer-input';
import { entriesFromPaths, type FilesState } from './file-mentions';
import type { CommandsState } from './slash-commands';

const READY: CommandsState = {
  status: 'ready',
  items: [
    { name: 'help', description: 'Show help', argumentHint: '' },
    { name: 'compact', description: 'Compact the context', argumentHint: '[focus]' },
    { name: 'clear', description: 'Clear the chat', argumentHint: '' },
  ],
};

@Component({
  imports: [ComposerInputComponent],
  template: `<app-composer-input [(draft)]="draft" [commands]="commands()" [files]="files()" (mentionOpened)="opened = opened + 1" (submitted)="submitted = submitted + 1" />`,
})
class Host {
  readonly draft = signal('');
  readonly commands = signal<CommandsState>(READY);
  readonly files = signal<FilesState>({ status: 'idle' });
  opened = 0;
  submitted = 0;
}

describe('ComposerInputComponent', () => {
  async function render(commands: CommandsState = READY) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.commands.set(commands);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const box = () => el.querySelector('textarea') as HTMLTextAreaElement;
    const options = () => Array.from(el.querySelectorAll('[role="option"]')) as HTMLElement[];
    const type = async (text: string) => {
      box().value = text;
      box().setSelectionRange(text.length, text.length);
      box().dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const key = async (k: string) => {
      const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      box().dispatchEvent(event);
      await fixture.whenStable();
      return event;
    };
    return { host: fixture.componentInstance, el, box, options, type, key };
  }

  it('opens the list on a leading slash and filters as you type', async () => {
    const { options, type } = await render();
    await type('/');
    expect(options().map((o) => o.querySelector('.name')?.textContent)).toEqual(['/help', '/compact', '/clear']);
    await type('/cl');
    expect(options().map((o) => o.querySelector('.name')?.textContent)).toEqual(['/clear']);
  });

  it('stays closed for text that is not a command', async () => {
    const { el, type } = await render();
    await type('hello /he');
    expect(el.querySelector('.menu')).toBeNull();
  });

  it('Tab inserts the highlighted command and closes the list', async () => {
    const { host, box, el, type, key } = await render();
    await type('/he');
    const event = await key('Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(host.draft()).toBe('/help ');
    expect(box().value).toBe('/help ');
    expect(box().selectionStart).toBe(6);
    expect(el.querySelector('.menu')).toBeNull();
    expect(host.submitted).toBe(0);
  });

  it('ArrowDown moves the highlight before Tab picks', async () => {
    const { host, type, key } = await render();
    await type('/');
    await key('ArrowDown');
    await key('Tab');
    expect(host.draft()).toBe('/compact ');
  });

  it('Enter picks instead of sending while the list has matches', async () => {
    const { host, type, key } = await render();
    await type('/cl');
    await key('Enter');
    expect(host.draft()).toBe('/clear ');
    expect(host.submitted).toBe(0);
  });

  it('keeps the highlight inside the list when moving the caret narrows the matches', async () => {
    const { host, box, options, key } = await render();
    box().value = '/clear';
    box().setSelectionRange(2, 2);
    box().dispatchEvent(new Event('input'));
    await key('ArrowDown');
    expect(options()).toHaveLength(2);
    box().setSelectionRange(3, 3);
    box().dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    await key('Tab');
    expect(host.draft().startsWith('/clear ')).toBe(true);
  });

  it('Shift+Enter leaves the list alone so it can insert a newline', async () => {
    const { host, box, type } = await render();
    await type('/he');
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
    box().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(host.draft()).toBe('/he');
    expect(host.submitted).toBe(0);
  });

  it('Escape closes the list and Enter then submits', async () => {
    const { host, el, type, key } = await render();
    await type('/zz');
    await key('Escape');
    expect(el.querySelector('.menu')).toBeNull();
    await key('Enter');
    expect(host.submitted).toBe(1);
  });

  it('Enter submits when no list is open', async () => {
    const { host, type, key } = await render();
    await type('hello');
    await key('Enter');
    expect(host.submitted).toBe(1);
  });

  it('shows loading, failure and no-match distinctly', async () => {
    const loading = await render({ status: 'loading' });
    await loading.type('/');
    expect(loading.el.querySelector('.status')?.textContent).toContain('Loading');
    TestBed.resetTestingModule();

    const failed = await render({ status: 'failed', detail: 'boom' });
    await failed.type('/');
    expect(failed.el.querySelector('.status--error')?.textContent).toContain('boom');
    TestBed.resetTestingModule();

    const empty = await render();
    await empty.type('/zzz');
    expect(empty.el.querySelector('.status')?.textContent).toContain('No commands match');
  });

  describe('@ mentions', () => {
    const FILES: FilesState = {
      status: 'ready',
      truncated: false,
      entries: entriesFromPaths(['src/app/chat.ts', 'src/chat/readme.md', 'mi carpeta/a b.ts', 'docs/notes.md']),
    };
    const labels = (options: () => HTMLElement[]) => options().map((o) => o.querySelector('.name')?.textContent);

    it('opens after @ at the start or after a space, asking for the file list', async () => {
      const { host, el, type } = await render();
      host.files.set(FILES);
      await type('@');
      expect(el.querySelector('#mention-menu')).not.toBeNull();
      expect(host.opened).toBe(1);
      await type('mira @');
      expect(el.querySelector('#mention-menu')).not.toBeNull();
    });

    it('stays closed inside an email address', async () => {
      const { host, el, type } = await render();
      host.files.set(FILES);
      await type('correo@dominio');
      expect(el.querySelector('.menu')).toBeNull();
      expect(host.opened).toBe(0);
    });

    it('lists the root level, folders first and then files, each alphabetical', async () => {
      const { host, options, type } = await render();
      host.files.set({
        status: 'ready',
        truncated: false,
        entries: entriesFromPaths(['zeta.ts', 'src/app/chat.ts', 'README.md', 'docs/notes.md', 'a.ts', 'Lib/x.ts']),
      });
      await type('@');
      expect(labels(options)).toEqual(['docs/', 'Lib/', 'src/', 'a.ts', 'README.md', 'zeta.ts']);
    });

    it('filters only the current level, prefix matches first', async () => {
      const { host, options, type } = await render();
      host.files.set({
        status: 'ready',
        truncated: false,
        entries: entriesFromPaths(['cat.ts', 'abc.ts', 'src/cat.ts', 'zzz.ts', 'src/deep/c.ts']),
      });
      await type('@c');
      expect(labels(options)).toEqual(['cat.ts', 'src/', 'abc.ts']);
      await type('@zzz.tsx');
      expect(options()).toHaveLength(0);
      await type('@src/c');
      expect(labels(options)).toEqual(['cat.ts']);
    });

    it('ArrowRight on a folder enters it, replacing the list with its content', async () => {
      const { host, options, type, key } = await render();
      host.files.set(FILES);
      await type('@sr');
      expect(labels(options)).toEqual(['src/']);
      const event = await key('ArrowRight');
      expect(event.defaultPrevented).toBe(true);
      expect(host.draft()).toBe('@src/');
      expect(labels(options)).toEqual(['app/', 'chat/']);
    });

    it('Tab and Enter on a folder enter it instead of inserting or sending', async () => {
      const { host, options, type, key } = await render();
      host.files.set(FILES);
      await type('@src');
      await key('Enter');
      expect(host.draft()).toBe('@src/');
      expect(host.submitted).toBe(0);
      expect(labels(options)).toEqual(['app/', 'chat/']);
      await key('ArrowDown');
      await key('Tab');
      expect(host.draft()).toBe('@src/chat/');
      expect(labels(options)).toEqual(['readme.md']);
    });

    it('goes down level after level until a file is picked', async () => {
      const { host, el, options, type, key } = await render();
      host.files.set(FILES);
      await type('@src/');
      await key('ArrowRight');
      expect(host.draft()).toBe('@src/app/');
      expect(labels(options)).toEqual(['chat.ts']);
      await key('Tab');
      expect(host.draft()).toBe('@src/app/chat.ts ');
      expect(el.querySelector('.menu')).toBeNull();
    });

    it('keeps the arrow keys for the text when the highlighted row is a file or the caret is inside the word', async () => {
      const { host, box, type, key } = await render();
      host.files.set(FILES);
      await type('@docs/');
      const onFile = await key('ArrowRight');
      expect(onFile.defaultPrevented).toBe(false);
      expect(host.draft()).toBe('@docs/');
      await type('@src');
      box().setSelectionRange(1, 1);
      const inside = await key('ArrowRight');
      expect(inside.defaultPrevented).toBe(false);
      expect(host.draft()).toBe('@src');
    });

    it('enters a folder when the caret is at the end of the word but not of the text', async () => {
      const { host, box, type, key } = await render();
      host.files.set(FILES);
      await type('@src bla');
      box().setSelectionRange(4, 4);
      box().dispatchEvent(new Event('keyup'));
      const event = await key('ArrowRight');
      expect(event.defaultPrevented).toBe(true);
      expect(host.draft()).toBe('@src/ bla');
    });

    it('ArrowLeft right after a slash goes back one level and highlights the folder it left', async () => {
      const { host, el, options, type, key } = await render();
      host.files.set(FILES);
      await type('@src/app/');
      expect(labels(options)).toEqual(['chat.ts']);
      const event = await key('ArrowLeft');
      expect(event.defaultPrevented).toBe(true);
      expect(host.draft()).toBe('@src/');
      expect(labels(options)).toEqual(['app/', 'chat/']);
      expect(el.querySelector('[data-active] .name')?.textContent).toBe('app/');
      await type('@src/chat/');
      await key('ArrowLeft');
      expect(el.querySelector('[data-active] .name')?.textContent).toBe('chat/');
    });

    it('climbs level after level up to the root, where ArrowLeft moves the caret as usual', async () => {
      const { host, options, type, key } = await render();
      host.files.set(FILES);
      await type('@src/app/');
      await key('ArrowLeft');
      await key('ArrowLeft');
      expect(host.draft()).toBe('@');
      expect(labels(options)).toEqual(['docs/', 'mi carpeta/', 'src/']);
      const atRoot = await key('ArrowLeft');
      expect(atRoot.defaultPrevented).toBe(false);
      expect(host.draft()).toBe('@');
      expect(options()).toHaveLength(3);
    });

    it('ArrowLeft keeps moving the caret while a filter is typed after the slash', async () => {
      const { host, type, key } = await render();
      host.files.set(FILES);
      await type('@src/ap');
      const event = await key('ArrowLeft');
      expect(event.defaultPrevented).toBe(false);
      expect(host.draft()).toBe('@src/ap');
    });

    it('deleting the slash with backspace shows the parent level filtered by the folder name', async () => {
      const { host, options, type } = await render();
      host.files.set(FILES);
      await type('@src/');
      expect(labels(options)).toEqual(['app/', 'chat/']);
      await type('@src');
      expect(labels(options)).toEqual(['src/']);
    });

    it('goes back out of a quoted folder with spaces and keeps the text after the word', async () => {
      const { host, box, options, type, key } = await render();
      host.files.set(FILES);
      await type('@"mi carpeta/ bla');
      box().setSelectionRange('@"mi carpeta/'.length, '@"mi carpeta/'.length);
      box().dispatchEvent(new Event('keyup'));
      await key('Shift'); // lets the caret move settle
      expect(labels(options)).toEqual(['a b.ts']);
      await key('ArrowLeft');
      expect(host.draft()).toBe('@ bla');
      expect(labels(options)).toEqual(['docs/', 'mi carpeta/', 'src/']);
    });

    it('ArrowLeft inside a word does not leave the level or glue the rest of the word on', async () => {
      const { host, box, type, key } = await render();
      host.files.set(FILES);
      await type('@src/app/foo');
      box().setSelectionRange('@src/app/'.length, '@src/app/'.length);
      const event = await key('ArrowLeft');
      expect(event.defaultPrevented).toBe(false);
      expect(host.draft()).toBe('@src/app/foo');
    });

    it('leaves a level that has no rows', async () => {
      const { host, options, type, key } = await render();
      host.files.set(FILES);
      await type('@nosuch/');
      expect(options()).toHaveLength(0);
      await key('ArrowLeft');
      expect(host.draft()).toBe('@');
    });

    it('enters a folder whose name has spaces with an open quote', async () => {
      const { host, options, type, key } = await render();
      host.files.set(FILES);
      await type('@mi');
      expect(labels(options)).toEqual(['mi carpeta/']);
      await key('Tab');
      expect(host.draft()).toBe('@"mi carpeta/');
      expect(labels(options)).toEqual(['a b.ts']);
      await key('Tab');
      expect(host.draft()).toBe('@"mi carpeta/a b.ts" ');
    });

    it('caps the list at 50 results', async () => {
      const { host, options, type } = await render();
      host.files.set({ status: 'ready', truncated: false, entries: entriesFromPaths(Array.from({ length: 80 }, (_, i) => `f${i}.ts`)) });
      await type('@f');
      expect(options()).toHaveLength(50);
    });

    it('Tab inserts @path with a trailing space and keeps the focus in the textarea', async () => {
      const { host, box, el, type, key } = await render();
      host.files.set(FILES);
      await type('mira @docs/notes');
      await key('Tab');
      expect(host.draft()).toBe('mira @docs/notes.md ');
      expect(box().selectionStart).toBe('mira @docs/notes.md '.length);
      expect(el.querySelector('.menu')).toBeNull();
      expect(host.submitted).toBe(0);
    });

    it('quotes paths with spaces', async () => {
      const { host, type, key } = await render();
      host.files.set(FILES);
      await type('@"mi carpeta/a b');
      await key('Enter');
      expect(host.draft()).toBe('@"mi carpeta/a b.ts" ');
    });

    it('Escape closes the popup so a literal @ can stay', async () => {
      const { host, el, type, key } = await render();
      host.files.set(FILES);
      await type('@a');
      await key('Escape');
      expect(el.querySelector('.menu')).toBeNull();
      expect(host.draft()).toBe('@a');
    });

    it('shows loading, failure and no-match distinctly', async () => {
      const { host, el, type } = await render();
      host.files.set({ status: 'loading' });
      await type('@');
      expect(el.querySelector('.status')?.textContent).toContain('Loading');
      host.files.set({ status: 'failed', detail: 'git exploded' });
      await type('@');
      expect(el.querySelector('.status--error')?.textContent).toContain('git exploded');
    });
  });
});
