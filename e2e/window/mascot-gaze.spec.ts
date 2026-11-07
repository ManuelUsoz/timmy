import { expect, test, type Timmy } from '../fixtures';

/** How far the eyes are shifted, in units of the 128-unit drawing, as the browser draws them (after the ease). */
const eyeShift = (timmy: Timmy, mascot = timmy.page.locator('ui-mascot').first()) =>
  mascot
    .locator('.gaze')
    .evaluate((el) => {
      const matrix = new DOMMatrix(getComputedStyle(el).transform);
      return { x: Math.round(matrix.m41 * 10) / 10, y: Math.round(matrix.m42 * 10) / 10 };
    });

test.describe('the Mascot looks at the cursor wherever it is on screen', () => {
  test.use({ language: 'en' });

  test('looks straight ahead until it knows where the cursor is', async ({ timmy }) => {
    expect(await eyeShift(timmy)).toEqual({ x: 0, y: 0 });
    await timmy.shot('mascot-gaze-ahead');
  });

  test('moves its eyes toward a cursor on each side, in the Pill', async ({ timmy }) => {
    const mascot = timmy.page.locator('ui-pill ui-mascot');
    const center = await timmy.desktopCenter(mascot);

    await timmy.moveCursor({ x: center.x + 100, y: center.y });
    await expect.poll(() => eyeShift(timmy, mascot)).toEqual({ x: 2, y: 0 });

    await timmy.moveCursor({ x: center.x + 600, y: center.y });
    await expect.poll(() => eyeShift(timmy, mascot)).toEqual({ x: 4, y: 0 });
    await timmy.shot('mascot-gaze-right');

    await timmy.moveCursor({ x: center.x - 600, y: center.y });
    await expect.poll(() => eyeShift(timmy, mascot)).toEqual({ x: -4, y: 0 });
    await timmy.shot('mascot-gaze-left');

    await timmy.moveCursor({ x: center.x, y: center.y - 600 });
    await expect.poll(() => eyeShift(timmy, mascot)).toEqual({ x: 0, y: -4 });
    await timmy.moveCursor({ x: center.x, y: center.y + 600 });
    await expect.poll(() => eyeShift(timmy, mascot)).toEqual({ x: 0, y: 4 });
  });

  test('never pushes the eyes off the face, however far the cursor is, even on another display', async ({ timmy }) => {
    const mascot = timmy.page.locator('ui-pill ui-mascot');
    const center = await timmy.desktopCenter(mascot);
    // A display to the left of the primary one has negative coordinates.
    await timmy.moveCursor({ x: -3840, y: center.y - 3000 });
    await expect.poll(async () => {
      const { x, y } = await eyeShift(timmy, mascot);
      return { reaches: Math.hypot(x, y) <= 4, towardLeft: x < 0, towardUp: y < 0 };
    }).toEqual({ reaches: true, towardLeft: true, towardUp: true });
  });

  test('follows the cursor in the Panel too, and again after the Expanded window', async ({ timmy }) => {
    await timmy.openPanel();
    const mascot = timmy.page.locator('app-panel-rail ui-mascot');
    const center = await timmy.desktopCenter(mascot);
    await timmy.moveCursor({ x: center.x - 600, y: center.y });
    await expect.poll(() => eyeShift(timmy, mascot)).toEqual({ x: -4, y: 0 });
    await timmy.shot('mascot-gaze-panel');

    // The stream is quiet in Expanded; back in the Pill it resumes by itself and the eyes find the cursor.
    await timmy.switchMode('Expanded');
    await timmy.moveCursor({ x: 5000, y: 0 });
    await timmy.switchMode('Pill');
    const pillMascot = timmy.page.locator('ui-pill ui-mascot');
    await expect.poll(async () => (await eyeShift(timmy, pillMascot)).x).toBeGreaterThan(0);
  });

  // Eye movement is small, so it stays under reduced motion (#93); only the body's motion stops.
  test('keeps following the cursor under reduced motion', async ({ timmy }) => {
    const mascot = timmy.page.locator('ui-pill ui-mascot');
    const center = await timmy.desktopCenter(mascot);
    await timmy.page.emulateMedia({ reducedMotion: 'reduce' });
    await timmy.moveCursor({ x: center.x + 600, y: center.y });
    await expect.poll(() => eyeShift(timmy, mascot)).toEqual({ x: 4, y: 0 });
    await timmy.moveCursor({ x: center.x - 600, y: center.y });
    await expect.poll(() => eyeShift(timmy, mascot)).toEqual({ x: -4, y: 0 });
  });
});
