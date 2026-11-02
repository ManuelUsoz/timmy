import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import { AttachmentId } from '../../../shared/attachments/attachment.model';
import { AttachmentsError } from '../../../shared/attachments/attachments-error.model';
import { AttachmentsRpcs } from '../../../shared/attachments/attachments.rpc';
import { ChatError } from '../../../shared/chat/chat-error.model';
import { ChatRpcs } from '../../../shared/chat/chat.rpc';
import type { ModelInfo } from '../../../shared/chat/provider.model';
import { SessionId } from '../../../shared/chat/ids.model';
import type { UserMessage } from '../../../shared/chat/session.model';
import { SessionsRpcs } from '../../../shared/sessions/sessions.rpc';
import {
  layerFilesUnused,
  layerProjectsUnused,
  layerSettingsUnused,
  layerWindowUnused,
  makeDesktopTestLayer,
} from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { ChatViewComponent } from './chat-view';

const unused = () => Effect.die('not under test');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const pngFile = () => new File([PNG], 'shot.png', { type: 'image/png' });

interface SetupOptions {
  /** What the adapter declares for every model. */
  readonly images?: boolean;
  readonly models?: ReadonlyArray<ModelInfo>;
  /** Makes Chat.send fail the way main does for a text-only model. */
  readonly refuseImages?: boolean;
}

const setup = async ({ images = true, models = [], refuseImages = false }: SetupOptions = {}) => {
  const sent: UserMessage[] = [];
  const added: Uint8Array[] = [];
  const removed: string[] = [];
  const sessionId = SessionId.make('s1');
  let next = 0;
  const handlers = Layer.mergeAll(
    AppInfoRpcs.toLayer({
      'AppInfo.get': () =>
        Effect.succeed({ name: 't', version: '1', electron: '1', chrome: '1', node: '1', platform: 'win32', cwd: '/work' }),
    }),
    ChatRpcs.toLayer({
      'Chat.capabilities': () =>
        Effect.succeed({
          provider: 'Claude' as const,
          subagents: true,
          toolCalls: true,
          permissions: true,
          permissionModes: ['Auto', 'AutoAccept', 'Default', 'Plan'],
          questions: true,
          thinking: true,
          resume: true,
          images,
          mentions: 'native' as const,
        }),
      'Chat.models': () => Effect.succeed(models),
      'Chat.commands': () => Effect.succeed([]),
      'Chat.changeAdapter': unused,
      'Chat.startSession': () => Effect.succeed(sessionId),
      'Chat.send': (message) => {
        if (refuseImages && message.attachments.length > 0) {
          return Stream.fail(new ChatError({ reason: 'ImagesUnsupported', detail: 'no images' }));
        }
        sent.push(message);
        return Stream.empty;
      },
      'Chat.resolvePermission': unused,
      'Chat.answerQuestion': unused,
      'Chat.interrupt': unused,
      'Chat.closeSession': () => Effect.void,
    }),
    AttachmentsRpcs.toLayer({
      'Attachments.add': ({ bytes }) => {
        if (bytes[0] === 0x00) return Effect.fail(new AttachmentsError({ reason: 'TooLarge', detail: 'big' }));
        if (bytes[0] !== 0x89) return Effect.fail(new AttachmentsError({ reason: 'UnsupportedType', detail: 'no' }));
        added.push(bytes);
        return Effect.succeed({ id: AttachmentId.make(`a${++next}`), mediaType: 'image/png' as const });
      },
      'Attachments.remove': ({ id }) =>
        Effect.sync(() => {
          removed.push(id);
        }),
    }),
    SessionsRpcs.toLayer({
      'Sessions.list': () => Effect.succeed([]),
      'Sessions.history': unused,
      'Sessions.listSubagents': () => Effect.succeed([]),
      'Sessions.rename': unused,
      'Sessions.delete': unused,
      'Sessions.changes': () => Stream.empty,
    }),
    layerWindowUnused,
    layerSettingsUnused,
    layerFilesUnused,
    layerProjectsUnused,
  );
  const layer = makeDesktopTestLayer(handlers);
  await TestBed.configureTestingModule({
    imports: [ChatViewComponent],
    providers: [
      {
        provide: EffectRuntime,
        useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ChatViewComponent);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  fixture.detectChanges();
  await settle();
  const paste = async (files: File[], text = '') => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files, getData: () => text } });
    (el.querySelector('textarea') as HTMLTextAreaElement).dispatchEvent(event);
    await settle();
    return event;
  };
  const drop = async (files: File[]) => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
    el.querySelector('form')!.dispatchEvent(event);
    await settle();
    return event;
  };
  const pick = async (files: File[]) => {
    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  };
  const chooseModel = async (id: string) => {
    fixture.componentInstance['modelControl'].setValue(id);
    await settle();
  };
  return { el, settle, sent, added, removed, paste, drop, pick, chooseModel };
};

describe('ChatViewComponent images', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:thumb');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows a thumbnail with a remove button for a pasted image, and keeps the paste out of the text', async () => {
    const { el, added, paste } = await setup();
    const event = await paste([pngFile()]);

    expect(event.defaultPrevented).toBe(true);
    expect(added).toEqual([PNG]);
    expect(el.querySelectorAll('.images img')).toHaveLength(1);
    expect(el.querySelector('.images .image-remove')).not.toBeNull();
  });

  it('lets pasted text through when the clipboard carries no image', async () => {
    const { el, added, paste } = await setup();
    const event = await paste([], 'just text');

    expect(event.defaultPrevented).toBe(false);
    expect(added).toEqual([]);
    expect(el.querySelector('.images')).toBeNull();
  });

  it('removes the thumbnail and deletes the stored file', async () => {
    const { el, removed, paste, settle } = await setup();
    await paste([pngFile()]);
    (el.querySelector('.image-remove') as HTMLButtonElement).click();
    await settle();

    expect(removed).toEqual(['a1']);
    expect(el.querySelector('.images')).toBeNull();
  });

  it('sends the images by id with the text, and clears the draft', async () => {
    const { el, sent, paste, settle } = await setup();
    await paste([pngFile()]);
    const box = el.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'what is this?';
    box.dispatchEvent(new Event('input'));
    await settle();
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ text: 'what is this?', mentions: [], attachments: [{ id: 'a1' }] });
    expect(el.querySelector('.images')).toBeNull();
  });

  const submit = async (el: HTMLElement, settle: () => Promise<void>) => {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  const dialog = (el: HTMLElement) => el.querySelector('[aria-modal="true"]');

  it('asks before sending an image with no text, and sends nothing yet', async () => {
    const { el, sent, paste, settle } = await setup();
    await paste([pngFile()]);
    await submit(el, settle);

    expect(sent).toHaveLength(0);
    expect(dialog(el)?.textContent).toContain('¿Enviar sin texto?');
    expect(dialog(el)?.textContent).toContain('Tu mensaje solo tiene imágenes.');
    expect(el.querySelectorAll('.images img')).toHaveLength(1);
  });

  it('sends the images when confirmed', async () => {
    const { el, sent, paste, settle } = await setup();
    await paste([pngFile()]);
    await submit(el, settle);
    (el.querySelector('[aria-modal="true"] .actions .primary') as HTMLButtonElement).click();
    await settle();

    expect(sent[0]).toMatchObject({ text: '', attachments: [{ id: 'a1' }] });
    expect(dialog(el)).toBeNull();
    expect(el.querySelector('.images')).toBeNull();
  });

  it.each([
    ['the close button', (el: HTMLElement) => (el.querySelector('[aria-modal="true"] .close') as HTMLButtonElement).click()],
    ['Esc', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['the backdrop', (el: HTMLElement) => (el.querySelector('.backdrop') as HTMLElement).click()],
  ])('keeps the draft untouched and refocuses the composer on %s', async (_name, dismiss) => {
    const { el, sent, paste, settle } = await setup();
    await paste([pngFile()]);
    await submit(el, settle);
    dismiss(el);
    await settle();

    expect(sent).toHaveLength(0);
    expect(dialog(el)).toBeNull();
    expect(el.querySelectorAll('.images img')).toHaveLength(1);
    expect(document.activeElement).toBe(el.querySelector('textarea'));
  });

  it('never asks when there is text', async () => {
    const { el, sent, paste, settle } = await setup();
    await paste([pngFile()]);
    const box = el.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'hi';
    box.dispatchEvent(new Event('input'));
    await settle();
    await submit(el, settle);

    expect(dialog(el)).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('never asks when there are no images (an empty draft sends nothing)', async () => {
    const { el, sent, settle } = await setup();
    await submit(el, settle);

    expect(dialog(el)).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('tells why in a modal, and shows no thumbnail, when main refuses the file', async () => {
    const { el, paste } = await setup();
    await paste([new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' })]);

    expect(el.querySelector('.images')).toBeNull();
    expect(el.querySelector('p.error')).toBeNull();
    expect(el.querySelector('[aria-modal="true"]')?.textContent).toContain('PNG');
  });

  it('closes the error modal with its button, and keeps working', async () => {
    const { el, paste, drop, settle } = await setup();
    await paste([new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' })]);
    (el.querySelector('[aria-modal="true"] .actions .primary') as HTMLButtonElement).click();
    await settle();

    expect(el.querySelector('[aria-modal="true"]')).toBeNull();
    await drop([pngFile()]);
    expect(el.querySelectorAll('.images img')).toHaveLength(1);
  });

  it('adds the images dropped onto the chat', async () => {
    const { el, added, drop } = await setup();
    const event = await drop([pngFile(), pngFile()]);

    expect(event.defaultPrevented).toBe(true);
    expect(added).toHaveLength(2);
    expect(el.querySelectorAll('.images img')).toHaveLength(2);
  });

  it('hints that images and files can be added, with files not available yet', async () => {
    const { el, settle } = await setup();
    el.querySelector('ui-tooltip.attach-tip')!.dispatchEvent(new Event('mouseenter'));
    await settle();
    expect(el.querySelector('[role="tooltip"]')?.textContent).toMatch(/(images|imágenes).*(files|archivos)/i);

    (el.querySelector('button.attach') as HTMLButtonElement).click();
    await settle();
    const items = Array.from(el.querySelectorAll<HTMLButtonElement>('.attach-menu button'));
    expect(items).toHaveLength(2);
    expect(items[0].disabled).toBe(false);
    expect(items[1].disabled).toBe(true);
  });

  it('opens a picker from the attach menu and adds what it returns', async () => {
    const { el, added, pick, settle } = await setup();
    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    const clicked = vi.spyOn(input, 'click');
    (el.querySelector('button.attach') as HTMLButtonElement).click();
    await settle();
    (el.querySelector('.attach-menu button') as HTMLButtonElement).click();
    await settle();
    expect(clicked).toHaveBeenCalled();
    expect(input.accept).toContain('image/png');
    expect(el.querySelector('.attach-menu')).toBeNull();
    await pick([pngFile()]);

    expect(added).toHaveLength(1);
    expect(el.querySelectorAll('.images img')).toHaveLength(1);
  });

  it('invites the user to drop while files are dragged over the chat, and stops when they leave or drop', async () => {
    const { el, settle, drop } = await setup();
    const drag = async (type: string, types: string[] = ['Files']) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { types, files: [] } });
      el.dispatchEvent(event);
      await settle();
    };
    await drag('dragenter', ['text/plain']);
    expect(el.querySelector('.drop-hint')).toBeNull();

    await drag('dragenter');
    expect(el.querySelector('.drop-hint')?.textContent).toMatch(/suelta|drop/i);
    await drag('dragleave');
    expect(el.querySelector('.drop-hint')).toBeNull();

    await drag('dragenter');
    await drop([pngFile()]);
    expect(el.querySelector('.drop-hint')).toBeNull();
  });

  it('refuses a sixth image with a modal, and keeps the five', async () => {
    const { el, added, drop } = await setup();
    await drop(Array.from({ length: 5 }, pngFile));
    expect(el.querySelectorAll('.images img')).toHaveLength(5);
    await drop([pngFile()]);

    expect(added).toHaveLength(5);
    expect(el.querySelectorAll('.images img')).toHaveLength(5);
    expect(el.querySelector('[aria-modal="true"]')?.textContent).toContain('5');
    expect(el.querySelector('p.error')).toBeNull();
  });

  it('attaches none of a batch that would pass five, and says so in a modal', async () => {
    const { el, added, drop } = await setup();
    await drop(Array.from({ length: 7 }, pngFile));

    expect(added).toEqual([]);
    expect(el.querySelector('.images')).toBeNull();
    expect(el.querySelector('[aria-modal="true"]')).not.toBeNull();
  });

  it('says an image is too large when main refuses it for its size', async () => {
    const { el, drop } = await setup();
    await drop([new File([new Uint8Array([0, 1])], 'huge.png', { type: 'image/png' })]);

    expect(el.querySelector('.images')).toBeNull();
    expect(el.querySelector('[aria-modal="true"]')?.textContent).toContain('5 MB');
  });

  it('rejects a dropped file that is not an image', async () => {
    const { el, drop } = await setup();
    await drop([new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' })]);

    expect(el.querySelector('.images')).toBeNull();
    expect(el.querySelector('[aria-modal="true"]')?.textContent).toContain('PNG');
  });

  it('takes a file dropped anywhere on the chat, so the window never navigates to it', async () => {
    const { el, added } = await setup();
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [pngFile()], types: ['Files'] } });
    el.querySelector('.title')!.dispatchEvent(event);
    await new Promise((r) => setTimeout(r));

    expect(event.defaultPrevented).toBe(true);
    expect(added).toHaveLength(1);
  });

  it('refuses a huge file without reading it', async () => {
    const { el, added, drop } = await setup();
    const huge = new File([], 'big.png', { type: 'image/png' });
    Object.defineProperty(huge, 'size', { value: 60 * 1024 * 1024 });
    await drop([huge]);

    expect(added).toEqual([]);
    expect(el.querySelector('[aria-modal="true"]')?.textContent).toContain('5 MB');
  });

  describe('on a model that takes no images', () => {
    const models: ModelInfo[] = [
      { id: 'text', efforts: ['Default'], images: false },
      { id: 'vision', efforts: ['Default'], images: true },
    ];
    const submit = (el: HTMLElement) => el.querySelector('button[type="submit"]') as HTMLButtonElement;

    it('disables the attach button with the reason as its hint, and refuses paste and drop with a modal', async () => {
      const { el, added, paste, drop, settle } = await setup({ images: false });
      expect((el.querySelector('button.attach') as HTMLButtonElement).disabled).toBe(true);
      el.querySelector('ui-tooltip.attach-tip')!.dispatchEvent(new Event('mouseenter'));
      await settle();
      expect(el.querySelector('[role="tooltip"]')?.textContent).toMatch(/no admite im|does not take images/i);

      await paste([pngFile()]);
      expect(el.querySelector('[aria-modal="true"]')?.textContent).toMatch(/no admite im|does not take images/i);
      (el.querySelector('[aria-modal="true"] .actions .primary') as HTMLButtonElement).click();
      await settle();
      await drop([pngFile()]);
      expect(added).toEqual([]);
      expect(el.querySelector('.images')).toBeNull();
    });

    it('keeps the pending images when the model changes, blocks Send with a reason, and unblocks on a model with vision', async () => {
      const { el, paste, chooseModel } = await setup({ models });
      await paste([pngFile()]);
      expect(submit(el).disabled).toBe(false);

      await chooseModel('text');
      expect(el.querySelectorAll('.images img')).toHaveLength(1);
      expect(submit(el).disabled).toBe(true);
      expect(el.querySelector('.images-blocked')?.textContent).toMatch(/no admite im|does not take images/i);

      await chooseModel('vision');
      expect(submit(el).disabled).toBe(false);
      expect(el.querySelector('.images-blocked')).toBeNull();
    });

    it('sends again once the images are removed', async () => {
      const { el, sent, paste, chooseModel, settle } = await setup({ models });
      await paste([pngFile()]);
      await chooseModel('text');
      const box = el.querySelector('textarea') as HTMLTextAreaElement;
      box.value = 'hello';
      box.dispatchEvent(new Event('input'));
      await settle();
      expect(submit(el).disabled).toBe(true);

      (el.querySelector('.image-remove') as HTMLButtonElement).click();
      await settle();
      expect(submit(el).disabled).toBe(false);
      el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();
      expect(sent[0]).toMatchObject({ text: 'hello', attachments: [] });
    });

    it('keeps the draft and the thumbnails when main answers ImagesUnsupported', async () => {
      const { el, sent, paste, settle } = await setup({ refuseImages: true });
      await paste([pngFile()]);
      const box = el.querySelector('textarea') as HTMLTextAreaElement;
      box.value = 'look at this';
      box.dispatchEvent(new Event('input'));
      await settle();
      el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();

      expect(sent).toEqual([]);
      expect((el.querySelector('textarea') as HTMLTextAreaElement).value).toBe('look at this');
      expect(el.querySelectorAll('.images img')).toHaveLength(1);
      expect(el.textContent).toMatch(/no admite im|does not take images/i);
    });
  });

  const sendWithImage = async (ctx: Awaited<ReturnType<typeof setup>>) => {
    await ctx.paste([pngFile()]);
    const box = ctx.el.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'look';
    box.dispatchEvent(new Event('input'));
    await ctx.settle();
    ctx.el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await ctx.settle();
  };

  it('AC 1: shows the sent images as thumbnails in the transcript', async () => {
    const ctx = await setup();
    await sendWithImage(ctx);

    expect(ctx.el.querySelectorAll('.log .message-image img')).toHaveLength(1);
    expect(ctx.el.querySelector('.images')).toBeNull();
  });

  it('AC 2: clicking a transcript thumbnail opens the lightbox, which closes with its button, Esc and the backdrop', async () => {
    const ctx = await setup();
    await sendWithImage(ctx);
    const open = async () => {
      (ctx.el.querySelector('.log .message-image') as HTMLButtonElement).click();
      await ctx.settle();
      expect(ctx.el.querySelector('.lightbox img')).not.toBeNull();
    };

    await open();
    (ctx.el.querySelector('.lightbox .lightbox-close') as HTMLButtonElement).click();
    await ctx.settle();
    expect(ctx.el.querySelector('.lightbox')).toBeNull();

    await open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await ctx.settle();
    expect(ctx.el.querySelector('.lightbox')).toBeNull();

    await open();
    (ctx.el.querySelector('.lightbox-backdrop') as HTMLElement).click();
    await ctx.settle();
    expect(ctx.el.querySelector('.lightbox')).toBeNull();
  });

  it('AC 2: clicking a composer thumbnail opens the lightbox', async () => {
    const ctx = await setup();
    await ctx.paste([pngFile()]);
    (ctx.el.querySelector('.images .image-open') as HTMLButtonElement).click();
    await ctx.settle();

    expect(ctx.el.querySelector('.lightbox img')).not.toBeNull();
    expect(ctx.removed).toEqual([]);
  });
});
