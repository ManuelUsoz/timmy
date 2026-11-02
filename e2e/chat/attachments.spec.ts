import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { expect, test, type Timmy } from '../fixtures';

test.use({ language: 'en' });

// ---- fixtures: tiny valid images built in memory, no binary files -------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
};

/** A valid solid-colour PNG. Different colours make thumbnails distinguishable in screenshots. */
const png = (r: number, g: number, b: number, width = 48, height = 32): string => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
};

const COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [220, 60, 60],
  [60, 160, 90],
  [60, 100, 220],
  [230, 180, 40],
  [150, 70, 200],
  [40, 190, 200],
];
const pngN = (n: number) => png(...COLORS[n % COLORS.length]);

/** A text file that only claims to be a PNG: wrong magic bytes. */
const FAKE_PNG = Buffer.from('this is plain text, not an image').toString('base64');
const TEXT_FILE = Buffer.from('just some notes').toString('base64');

interface Fixture {
  name: string;
  mime: string;
  base64: string;
}
const image = (n: number, name = `shot-${n + 1}.png`): Fixture => ({ name, mime: 'image/png', base64: pngN(n) });

// ---- helpers: synthetic paste and drop ---------------------------------------------------------

/** Runs in the page: builds a DataTransfer from base64 fixtures and fires the events a real paste or drop would. */
function dispatch(page: Page, kind: 'paste' | 'dragenter' | 'drop', files: Fixture[]) {
  return page.evaluate(
    ({ kind, files }) => {
      const data = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        data.items.add(new File([bytes], f.name, { type: f.mime }));
      }
      if (kind === 'paste') {
        const box = document.querySelector('textarea') as HTMLTextAreaElement;
        box.focus();
        box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        return;
      }
      const target = document.querySelector('form.composer')!;
      const types = kind === 'dragenter' ? ['dragenter'] : ['dragenter', 'dragover', 'drop'];
      for (const type of types) target.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
    },
    { kind, files },
  );
}
const paste = (page: Page, files: Fixture[]) => dispatch(page, 'paste', files);
const dragOver = (page: Page, files: Fixture[]) => dispatch(page, 'dragenter', files);
const drop = (page: Page, files: Fixture[]) => dispatch(page, 'drop', files);

const thumbs = (t: Timmy) => t.page.locator('ul.images li.image');
const sendButton = (t: Timmy) => t.page.getByRole('button', { name: 'Send' });
const errorModal = (t: Timmy) => t.page.getByRole('alertdialog', { name: 'Could not attach' });
const attachButton = (t: Timmy) => t.page.getByRole('button', { name: 'Attach' });
const BLOCKED = 'This model does not take images. Remove the images or choose another model.';

async function pickModel(t: Timmy, name: string) {
  await t.page.locator('.mp-trigger').click();
  await t.page.getByRole('radio', { name }).click();
  await t.page.keyboard.press('Escape');
  await t.settle(200);
}

async function closePicker(t: Timmy) {
  // The picker popover closes on outside click; the composer is a safe neutral target.
  if (await t.page.locator('.mp-pop').count()) await t.composer().click();
}

// ---- NXY-75: paste -----------------------------------------------------------------------------

test('pasting a screenshot shows a thumbnail that can be removed', async ({ timmy }) => {
  await timmy.openPanel();
  await paste(timmy.page, [image(0)]);
  await expect(thumbs(timmy)).toHaveCount(1);
  await expect(timmy.page.getByRole('img', { name: 'Attached image' })).toBeVisible();
  await expect(sendButton(timmy)).toBeEnabled();
  // look: one small red thumbnail with an X above the composer input, Send enabled.
  await timmy.shot('attachments-pasted-thumbnail');

  await timmy.page.getByRole('button', { name: 'Remove image' }).click();
  await expect(thumbs(timmy)).toHaveCount(0);
  await expect(sendButton(timmy)).toBeDisabled();
});

test('pasting plain text does not attach anything', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'hello');
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    box.focus();
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(thumbs(timmy)).toHaveCount(0);
});

test('an image with text is sent and the strip clears', async ({ timmy }) => {
  await timmy.openPanel();
  await paste(timmy.page, [image(0), image(1)]);
  await expect(thumbs(timmy)).toHaveCount(2);
  await timmy.composer().fill('What is in these screenshots?');
  await sendButton(timmy).click();

  await expect(thumbs(timmy)).toHaveCount(0);
  await expect(timmy.page.getByText('What is in these screenshots?').first()).toBeVisible();
  await timmy.text('Here is what I found.');
  await expect(timmy.composer()).toHaveValue('');
});

// ---- NXY-76: drop, picker, limits, errors -----------------------------------------------------

test('dragging a file over the chat shows the drop hint, dropping attaches it', async ({ timmy }) => {
  await timmy.openPanel();
  await dragOver(timmy.page, [image(2)]);
  await expect(timmy.page.getByText('Drop here to attach')).toBeVisible();
  // look: composer highlighted with a "Drop here to attach" hint.
  await timmy.shot('attachments-drop-hint');

  await drop(timmy.page, [image(2)]);
  await expect(timmy.page.getByText('Drop here to attach')).toBeHidden();
  await expect(thumbs(timmy)).toHaveCount(1);
});

test('the attach button opens a menu and the picker adds images', async ({ timmy }) => {
  await timmy.openPanel();
  await attachButton(timmy).click();
  await expect(timmy.page.getByRole('menuitem', { name: 'Images' })).toBeEnabled();
  await expect(timmy.page.getByRole('menuitem', { name: 'Files' })).toBeDisabled();
  // The pointer rests on the button after the click and paints a hover artifact; park it for a stable shot.
  await timmy.page.mouse.move(5, 5);
  // look: small menu above/below the button with "Images" enabled and "Files" greyed out.
  await timmy.shot('attachments-attach-menu');

  // The menu item opens the native chooser; feed the hidden input directly instead.
  await timmy.page.locator('input[type=file]').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(pngN(0), 'base64') },
    { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(pngN(1), 'base64') },
  ]);
  await expect(thumbs(timmy)).toHaveCount(2);
  // look: two thumbnails (red, green) above the composer.
  await timmy.shot('attachments-picker-two');
});

test('the sixth image is refused with a modal and nothing is added', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.page.locator('input[type=file]').setInputFiles(
    Array.from({ length: 5 }, (_, n) => ({ name: `f${n}.png`, mimeType: 'image/png', buffer: Buffer.from(pngN(n), 'base64') })),
  );
  await expect(thumbs(timmy)).toHaveCount(5);

  await drop(timmy.page, [image(5)]);
  await expect(errorModal(timmy)).toBeVisible();
  await expect(timmy.page.getByText('A message takes up to 5 images. None of the new ones were attached.')).toBeVisible();
  await expect(thumbs(timmy)).toHaveCount(5);
  // look: dimmed, blurred chat with a "Could not attach" modal and the max-5 explanation.
  await timmy.shot('attachments-error-too-many');

  await timmy.page.getByRole('button', { name: 'Got it' }).click();
  await expect(errorModal(timmy)).toBeHidden();
});

test('a batch over the limit is refused whole', async ({ timmy }) => {
  await timmy.openPanel();
  await drop(timmy.page, Array.from({ length: 6 }, (_, n) => image(n)));
  await expect(errorModal(timmy)).toBeVisible();
  await expect(thumbs(timmy)).toHaveCount(0);
  await timmy.page.keyboard.press('Escape');
  await expect(errorModal(timmy)).toBeHidden();
});

test('an unsupported file type is rejected with a modal', async ({ timmy }) => {
  await timmy.openPanel();
  await drop(timmy.page, [{ name: 'notes.txt', mime: 'text/plain', base64: TEXT_FILE }]);
  await expect(errorModal(timmy)).toBeVisible();
  await expect(timmy.page.getByText('The image could not be attached. Use PNG, JPEG, GIF or WebP.')).toBeVisible();
  await expect(thumbs(timmy)).toHaveCount(0);
  // look: "Could not attach" modal saying to use PNG, JPEG, GIF or WebP.
  await timmy.shot('attachments-error-unsupported');

  await timmy.page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(errorModal(timmy)).toBeHidden();
});

test('a text file renamed .png (wrong magic bytes) is rejected', async ({ timmy }) => {
  await timmy.openPanel();
  await drop(timmy.page, [{ name: 'fake.png', mime: 'image/png', base64: FAKE_PNG }]);
  await expect(errorModal(timmy)).toBeVisible();
  await expect(timmy.page.getByText('The image could not be attached. Use PNG, JPEG, GIF or WebP.')).toBeVisible();
  await expect(thumbs(timmy)).toHaveCount(0);
  // look: same "Could not attach" modal as for an unsupported type, no thumbnail.
  await timmy.shot('attachments-error-fake-image');
});

test('a mixed drop keeps the valid image and reports the invalid one', async ({ timmy }) => {
  await timmy.openPanel();
  await drop(timmy.page, [image(0), { name: 'fake.png', mime: 'image/png', base64: FAKE_PNG }]);
  await expect(errorModal(timmy)).toBeVisible();
  await expect(thumbs(timmy)).toHaveCount(1);
});

// ---- NXY-74: modal behavior as seen through the error modal -----------------------------------

test('the error modal closes with the backdrop and returns to a usable composer', async ({ timmy }) => {
  await timmy.openPanel();
  await drop(timmy.page, [{ name: 'notes.txt', mime: 'text/plain', base64: TEXT_FILE }]);
  await expect(errorModal(timmy)).toBeVisible();
  await expect(timmy.page.getByRole('button', { name: 'Got it' })).toBeFocused();

  await timmy.page.locator('ui-modal .backdrop').click({ position: { x: 4, y: 4 }, force: true });
  await expect(errorModal(timmy)).toBeHidden();
  await timmy.composer().fill('still works');
  await expect(sendButton(timmy)).toBeEnabled();
});

// ---- NXY-77: text-only models ------------------------------------------------------------------

test('on a text-only model the attach button is disabled with a tooltip and paste/drop are refused', async ({ timmy }) => {
  await timmy.openPanel();
  await pickModel(timmy, 'mock-text');
  await expect(attachButton(timmy)).toBeDisabled();

  await timmy.page.locator('.attach-tip').hover();
  await expect(timmy.page.getByText(BLOCKED).first()).toBeVisible();
  // look: greyed attach button with the tooltip "This model does not take images...".
  await timmy.shot('attachments-text-only-attach-disabled');

  await timmy.page.mouse.move(0, 0);
  await paste(timmy.page, [image(0)]);
  await expect(errorModal(timmy)).toBeVisible();
  await expect(timmy.page.getByText(BLOCKED).first()).toBeVisible();
  await expect(thumbs(timmy)).toHaveCount(0);
  await timmy.page.getByRole('button', { name: 'Got it' }).click();

  await drop(timmy.page, [image(1)]);
  await expect(errorModal(timmy)).toBeVisible();
  await expect(thumbs(timmy)).toHaveCount(0);
});

test('pending images survive a switch to a text-only model, Send is blocked, and recovery works', async ({ timmy }) => {
  await timmy.openPanel();
  await paste(timmy.page, [image(0), image(1)]);
  await expect(thumbs(timmy)).toHaveCount(2);
  await timmy.composer().fill('Describe these');
  await expect(sendButton(timmy)).toBeEnabled();

  await pickModel(timmy, 'mock-text');
  await expect(thumbs(timmy)).toHaveCount(2);
  await expect(timmy.page.getByRole('status').filter({ hasText: BLOCKED })).toBeVisible();
  await expect(sendButton(timmy)).toBeDisabled();
  // look: thumbnails still there, red reason line under them, Send greyed out.
  await timmy.shot('attachments-send-blocked');

  // Recovery 1: remove the images.
  await timmy.page.getByRole('button', { name: 'Remove image' }).first().click();
  await timmy.page.getByRole('button', { name: 'Remove image' }).first().click();
  await expect(thumbs(timmy)).toHaveCount(0);
  await expect(timmy.page.getByRole('status').filter({ hasText: BLOCKED })).toBeHidden();
  await expect(sendButton(timmy)).toBeEnabled();
});

test('choosing an image-capable model again unblocks Send with the images kept', async ({ timmy }) => {
  await timmy.openPanel();
  await paste(timmy.page, [image(2)]);
  await timmy.composer().fill('Look');
  await pickModel(timmy, 'mock-text');
  await expect(sendButton(timmy)).toBeDisabled();

  await pickModel(timmy, 'mock-opus');
  await closePicker(timmy);
  await expect(thumbs(timmy)).toHaveCount(1);
  await expect(attachButton(timmy)).toBeEnabled();
  await expect(sendButton(timmy)).toBeEnabled();
});

// ---- NXY-78: image-only confirmation (not implemented yet) ------------------------------------

test.fixme('sending images with no text asks for confirmation first', async ({ timmy }) => {
  await timmy.openPanel();
  await paste(timmy.page, [image(0)]);
  await sendButton(timmy).click();
  const modal = timmy.page.getByRole('dialog', { name: 'Send without text?' });
  await expect(modal).toBeVisible();
  await expect(timmy.page.getByText('Your message has only images.')).toBeVisible();
  await expect(timmy.page.getByRole('button', { name: 'Send anyway' })).toBeFocused();
  // look: dimmed+blurred chat, modal "Send without text?" with primary "Send anyway", fits the Panel.
  await timmy.shot('attachments-image-only-confirm');
});

test.fixme('Send anyway sends the image-only message', async ({ timmy }) => {
  await timmy.openPanel();
  await paste(timmy.page, [image(0)]);
  await sendButton(timmy).click();
  await timmy.page.getByRole('button', { name: 'Send anyway' }).click();
  await expect(thumbs(timmy)).toHaveCount(0);
  await timmy.text('Here is what I found.');
});

test.fixme('cancelling the image-only confirmation keeps the draft (Close, Esc, backdrop)', async ({ timmy }) => {
  await timmy.openPanel();
  await paste(timmy.page, [image(0)]);
  for (const cancel of ['close', 'escape', 'backdrop'] as const) {
    await sendButton(timmy).click();
    const modal = timmy.page.getByRole('dialog', { name: 'Send without text?' });
    await expect(modal).toBeVisible();
    if (cancel === 'close') await timmy.page.getByRole('button', { name: 'Close', exact: true }).first().click();
    else if (cancel === 'escape') await timmy.page.keyboard.press('Escape');
    else await timmy.page.locator('ui-modal .backdrop').click({ position: { x: 4, y: 4 }, force: true });
    await expect(modal).toBeHidden();
    await expect(thumbs(timmy)).toHaveCount(1);
    await expect(timmy.composer()).toBeFocused();
  }
});

// ---- NXY-79: transcript thumbnails, lightbox, history (not implemented yet) --------------------

test('AC 1: a sent message shows its images as thumbnails in the transcript', async ({ timmy }) => {
  await timmy.openPanel();
  await paste(timmy.page, [image(0), image(1)]);
  await timmy.composer().fill('Compare these');
  await sendButton(timmy).click();
  await timmy.text('Here is what I found.');
  await expect(timmy.page.locator('ui-message img')).toHaveCount(2);
  // look: user bubble with two thumbnails above the text, then the agent answer.
  await timmy.shot('attachments-transcript-thumbnails');
});

test('AC 2: clicking a thumbnail opens the lightbox; the button, Esc and the backdrop close it', async ({ timmy }) => {
  await timmy.openPanel();
  await paste(timmy.page, [image(0)]);
  await timmy.composer().fill('Look');
  await sendButton(timmy).click();
  await timmy.text('Here is what I found.');
  const lightbox = timmy.page.getByRole('dialog', { name: 'Attached image' });
  const open = async () => {
    await timmy.page.locator('ui-message button.message-image').first().click();
    await expect(lightbox).toBeVisible();
  };

  await open();
  // look: the image enlarged over a dimmed, blurred window with a close button in its corner.
  await timmy.shot('attachments-lightbox');
  await timmy.page.getByRole('button', { name: 'Close image' }).click();
  await expect(lightbox).toBeHidden();

  await open();
  await timmy.page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();

  await open();
  await timmy.page.locator('.lightbox-backdrop').click({ position: { x: 4, y: 4 }, force: true });
  await expect(lightbox).toBeHidden();
});

test('AC 2: a composer thumbnail opens the lightbox without removing the image', async ({ timmy }) => {
  await timmy.openPanel();
  await paste(timmy.page, [image(0)]);
  await timmy.page.locator('ul.images button.image-open').click();
  await expect(timmy.page.getByRole('dialog', { name: 'Attached image' })).toBeVisible();
  await timmy.page.keyboard.press('Escape');
  await expect(thumbs(timmy)).toHaveCount(1);
});

test('AC 3 and 4: a reopened session shows its images, with a placeholder for one that could not be restored', async ({ timmy }) => {
  await timmy.openPanel();
  await timmy.page.getByText('Why is the pill clipped?').first().click();
  await timmy.text('The menu was rendered inside the 40px window.');
  await expect(timmy.page.locator('ui-message img')).toHaveCount(1);
  await expect(timmy.page.getByText('Image not available')).toBeVisible();
  // look: user bubble with one tiny image tile and one "Image not available" tile, then the answer.
  await timmy.shot('attachments-history-thumbnails');
});

// ---- NXY-80: cleanup (not implemented yet) -----------------------------------------------------

test.fixme('removed and unsent attachments are cleaned up', async ({ timmy }) => {
  // Remove a draft image, then relaunch with the same TIMMY_USER_DATA and assert the
  // attachments dir in app data holds no files for it. Needs a fixture hook to restart the app.
  await timmy.openPanel();
  await paste(timmy.page, [image(0)]);
});
