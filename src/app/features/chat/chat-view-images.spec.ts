import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import { AttachmentId } from '../../../shared/attachments/attachment.model';
import { AttachmentsError } from '../../../shared/attachments/attachments-error.model';
import { AttachmentsRpcs } from '../../../shared/attachments/attachments.rpc';
import { ChatRpcs } from '../../../shared/chat/chat.rpc';
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

const setup = async () => {
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
      'Chat.capabilities': unused,
      'Chat.models': () => Effect.succeed([]),
      'Chat.commands': () => Effect.succeed([]),
      'Chat.changeAdapter': unused,
      'Chat.startSession': () => Effect.succeed(sessionId),
      'Chat.send': (message) => {
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
  return { el, settle, sent, added, removed, paste, drop, pick };
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

  it('can send an image with no text', async () => {
    const { el, sent, paste, settle } = await setup();
    await paste([pngFile()]);
    const submit = el.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(sent[0]).toMatchObject({ text: '', attachments: [{ id: 'a1' }] });
  });

  it('says so, and shows no thumbnail, when main refuses the file', async () => {
    const { el, paste } = await setup();
    await paste([new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' })]);

    expect(el.querySelector('.images')).toBeNull();
    expect(el.querySelector('.error')?.textContent).toContain('PNG');
  });

  it('adds the images dropped onto the chat', async () => {
    const { el, added, drop } = await setup();
    const event = await drop([pngFile(), pngFile()]);

    expect(event.defaultPrevented).toBe(true);
    expect(added).toHaveLength(2);
    expect(el.querySelectorAll('.images img')).toHaveLength(2);
  });

  it('opens a picker from the attach button and adds what it returns', async () => {
    const { el, added, pick } = await setup();
    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    const clicked = vi.spyOn(input, 'click');
    (el.querySelector('button.attach') as HTMLButtonElement).click();
    expect(clicked).toHaveBeenCalled();
    expect(input.accept).toContain('image/png');
    await pick([pngFile()]);

    expect(added).toHaveLength(1);
    expect(el.querySelectorAll('.images img')).toHaveLength(1);
  });

  it('refuses a sixth image with a message, and keeps the five', async () => {
    const { el, added, drop } = await setup();
    await drop(Array.from({ length: 5 }, pngFile));
    expect(el.querySelectorAll('.images img')).toHaveLength(5);
    await drop([pngFile()]);

    expect(added).toHaveLength(5);
    expect(el.querySelectorAll('.images img')).toHaveLength(5);
    expect(el.querySelector('.error')?.textContent).toContain('5');
  });

  it('keeps the first five of a batch of seven and says the rest were left out', async () => {
    const { el, drop } = await setup();
    await drop(Array.from({ length: 7 }, pngFile));

    expect(el.querySelectorAll('.images img')).toHaveLength(5);
    expect(el.querySelector('.error')).not.toBeNull();
  });

  it('says an image is too large when main refuses it for its size', async () => {
    const { el, drop } = await setup();
    await drop([new File([new Uint8Array([0, 1])], 'huge.png', { type: 'image/png' })]);

    expect(el.querySelector('.images')).toBeNull();
    expect(el.querySelector('.error')?.textContent).toContain('5 MB');
  });

  it('rejects a dropped file that is not an image', async () => {
    const { el, drop } = await setup();
    await drop([new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' })]);

    expect(el.querySelector('.images')).toBeNull();
    expect(el.querySelector('.error')?.textContent).toContain('PNG');
  });
});
