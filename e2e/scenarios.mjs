// Scenarios for the e2e harness. Add one per user-visible flow; `intent` and each shot's `look`
// tell the reviewing agent what the UX is supposed to be. The mock adapter (electron/chat/
// mock-sdk-adapter.ts) picks its behavior from keywords in the message.

const visible = async (locator, timeout = 8000) => locator.first().waitFor({ state: 'visible', timeout });

/** @type {Array<{ name: string, intent: string, run: (t: any) => Promise<void> }>} */
export const scenarios = [
  {
    name: 'pill',
    intent: 'Timmy starts as a slim Pill at the bottom-right corner, idle.',
    async run(t) {
      await t.check('window is the 440x40 pill', async () => {
        const b = await t.bounds();
        if (Math.abs(b.width - 440) > 8 || Math.abs(b.height - 40) > 8) throw new Error(`got ${b.width}x${b.height}`);
      });
      await t.shot('idle', 'Single slim bar: avatar, idle label, mode and close buttons. Nothing clipped.');
    },
  },
  {
    name: 'panel',
    intent: 'Clicking the pill opens the Panel with the empty chat and the seeded session chips.',
    async run(t) {
      await t.openPanel();
      await t.check('panel is 440x560', async () => {
        const b = await t.bounds();
        if (Math.abs(b.width - 440) > 8 || Math.abs(b.height - 560) > 8) throw new Error(`got ${b.width}x${b.height}`);
      });
      await t.check('empty state and seeded sessions visible', async () => {
        await t.text('Say something to start a session.');
        await t.text('Explain the window modes');
      });
      await t.shot('empty', 'Header, session chip strip with 3 chips, title row, empty hint, composer with model/effort/permission selects.');
    },
  },
  {
    name: 'reply',
    intent: 'A plain message streams a markdown answer and shows context usage.',
    async run(t) {
      await t.openPanel();
      await t.send('Explain the architecture');
      await t.text('Working…');
      await t.shot('streaming', 'User bubble, partial agent answer or "Working…", Stop button instead of Send.');
      await t.check('answer rendered as markdown', async () => {
        await t.text('Here is what I found.');
        await visible(t.page.locator('.markdown code').first());
        await visible(t.page.getByText('27%'));
      });
      await t.shot('done', 'Rendered markdown (list + code block), context 27% in the composer bar, Send button back.');
    },
  },
  {
    name: 'permission-allow',
    intent: 'An edit asks for permission in an ask row; Allow lets the turn finish.',
    async run(t) {
      await t.openPanel();
      await t.send('please fix the startup mode');
      await visible(t.page.getByRole('button', { name: /^Allow:/ }));
      await t.shot('asking', 'Activity tree with Read done, ask row "Edit …" with Deny and Allow buttons above the composer.');
      await t.page.getByRole('button', { name: /^Allow:/ }).click();
      await t.check('turn completes after Allow', () => t.text('Done, the app now starts as a Panel.'));
      await t.shot('allowed', 'Ask row gone, confirmation message, Send button back.');
    },
  },
  {
    name: 'permission-deny',
    intent: 'Deny declines the edit and the agent says so.',
    async run(t) {
      await t.openPanel();
      await t.send('fix it');
      await visible(t.page.getByRole('button', { name: /^Deny:/ }));
      await t.page.getByRole('button', { name: /^Deny:/ }).click();
      await t.check('agent acknowledges denial', () => t.text('left the file unchanged'));
      await t.shot('denied', 'Ask row gone; the edit step shows as failed/declined in the activity tree.');
    },
  },
  {
    name: 'stop',
    intent: 'A long turn can be stopped; the UI returns to idle.',
    async run(t) {
      await t.openPanel();
      await t.send('run a long task');
      await visible(t.page.getByRole('button', { name: 'Stop' }));
      await t.shot('running', 'Stop button visible, "Working…" or streamed text.');
      await t.page.getByRole('button', { name: 'Stop' }).click();
      await t.check('Send button returns', () => visible(t.page.getByRole('button', { name: 'Send' })));
      await t.shot('stopped', 'Idle composer; the partial answer stays.');
    },
  },
  {
    name: 'pill-while-running',
    intent: 'Collapsing to the Pill during a turn shows the running state in the pill.',
    async run(t) {
      await t.openPanel();
      await t.send('run a long task');
      await visible(t.page.getByRole('button', { name: 'Stop' }));
      await t.switchMode('Pill');
      await t.shot('running', 'Pill with running tone/pulse and a label describing the work.');
    },
  },
  {
    name: 'thinking-and-agent',
    intent: 'Thinking blocks and subagent activity render.',
    async run(t) {
      await t.openPanel();
      await t.send('think and use an agent to search');
      await t.text('Here is what I found.', 12000);
      await t.shot('done', 'Collapsible "Thinking" section, activity tree with a subagent (Explore) and its Grep step.');
    },
  },
  {
    name: 'failure',
    intent: 'A failed turn shows an error and leaves the chat usable.',
    async run(t) {
      await t.openPanel();
      await t.send('make it fail with an error');
      await t.check('error shown', () => t.text('Mock failure'));
      await t.shot('failed', 'Red error line under the conversation; composer enabled.');
    },
  },
  {
    name: 'slash-menu',
    intent: 'Typing "/" opens the command menu.',
    async run(t) {
      await t.openPanel();
      await t.page.getByPlaceholder('Message Claude').fill('/');
      await t.check('commands listed', () => t.text('/compact'));
      await t.shot('open', 'Menu with /compact, /review <branch>, /init, readable and not clipped by the window.');
    },
  },
  {
    name: 'history',
    intent: 'Picking a session chip loads its stored conversation.',
    async run(t) {
      await t.openPanel();
      await t.page.getByText('Add a dark theme toggle').first().click();
      await t.check('stored messages appear', () => t.text('The toggle lives in the panel header.'));
      await t.shot('loaded', 'Chip selected, title row shows the session, user + assistant messages and the Edit tool step.');
    },
  },
  {
    name: 'expanded',
    intent: 'Expanded is the resizable Workspace window, with the rail and the Projects screen.',
    async run(t) {
      await t.openPanel();
      await t.switchMode('Expanded');
      await t.check('window opens at 1280x800 or 90 % of the work area', async () => {
        const b = await t.bounds();
        if (b.width < 800 || b.width > 1280 + 8 || b.height > 800 + 8) throw new Error(`got ${b.width}x${b.height}`);
      });
      await t.check('workspace is showing in Spanish', () => t.text('Proyectos'));
      const maximized = () => t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
      await t.check('has our own Minimizar, Maximizar and Cerrar controls', async () => {
        for (const name of ['Minimizar', 'Maximizar', 'Cerrar']) await t.page.getByRole('button', { name, exact: true }).waitFor({ timeout: 3000 });
      });
      await t.shot('workspace', 'Rail on the left with Chat, Proyectos, Historial, Ajustes; Projects column and placeholders; custom Carbon-style minimize, maximize and close at the top right, and no native Windows buttons.');
      await t.check('Maximizar maximizes the window and the control becomes Restaurar', async () => {
        await t.page.getByRole('button', { name: 'Maximizar', exact: true }).click();
        await t.page.getByRole('button', { name: 'Restaurar', exact: true }).waitFor({ timeout: 3000 });
        if (!(await maximized())) throw new Error('window is not maximized');
      });
      await t.shot('maximized', 'Workspace filling the work area; the middle control shows the restore icon (two overlapping squares).');
      await t.check('Restaurar restores the window', async () => {
        await t.page.getByRole('button', { name: 'Restaurar', exact: true }).click();
        await t.page.getByRole('button', { name: 'Maximizar', exact: true }).waitFor({ timeout: 3000 });
        if (await maximized()) throw new Error('window is still maximized');
      });
      await t.check('leaving Expanded shows no minimize or maximize in the Panel', async () => {
        await t.switchMode('Panel');
        if ((await t.page.getByRole('button', { name: 'Minimizar', exact: true }).count()) > 0) throw new Error('Minimizar still showing');
      });
      await t.shot('panel-after', 'Panel with only its own header: switcher and close, no minimize or maximize.');
    },
  },
];

