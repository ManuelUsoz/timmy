import { TestBed } from '@angular/core/testing';
import { Effect, Ref } from 'effect';
import { defaultSettings, type Provider, type Settings } from '../../../shared/settings/settings.model';
import { SettingsRpcs } from '../../../shared/settings/settings.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { ProviderSettings } from '../../core/provider-settings';
import { NewTerminal } from './new-terminal';

/** The real picker and `ProviderSettings` against a main whose settings are a Ref holding the enabled Providers. */
const setup = async (enabled: ReadonlyArray<Provider> = []) => {
  const stored = Ref.makeUnsafe<Settings>({ ...defaultSettings, providers: enabled });
  const handlers = SettingsRpcs.toLayer({
    'Settings.get': () => Ref.get(stored),
    'Settings.setLanguage': ({ language }) => Ref.updateAndGet(stored, (s) => ({ ...s, language })),
    'Settings.setProvider': ({ provider, enabled }) =>
      Ref.updateAndGet(stored, (s) => ({ ...s, providers: enabled ? [...s.providers, provider] : s.providers.filter((p) => p !== provider) })),
    'Settings.setChannel': () => Effect.die('unused'),

    'Settings.setReader': () => Effect.die('unused'),
  });
  const layer = makeDesktopTestLayer(handlers);
  TestBed.configureTestingModule({
    providers: [{ provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } }],
  });
  const fixture = TestBed.createComponent(NewTerminal);
  const el: HTMLElement = fixture.nativeElement;
  const chosen: Array<Provider | undefined> = [];
  fixture.componentInstance.chosen.subscribe((provider) => chosen.push(provider));
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  fixture.detectChanges();
  await settle();
  const button = () => el.querySelector<HTMLButtonElement>('button')!;
  const menu = () => el.querySelector('ui-menu');
  const entries = () => Array.from(el.querySelectorAll('ui-option')).map((option) => option.textContent?.trim());
  const entry = (name: string) => Array.from(el.querySelectorAll<HTMLElement>('ui-option')).find((option) => option.textContent?.trim() === name)!;
  const press = async () => {
    button().click();
    await settle();
  };
  return { fixture, chosen, settle, button, menu, entries, entry, press, providers: TestBed.inject(ProviderSettings) };
};

describe('NewTerminal', () => {
  it('opens a plain shell at once when no Provider is enabled, with nothing to pick from', async () => {
    const { chosen, menu, press } = await setup();
    await press();
    expect(chosen).toEqual([undefined]);
    expect(menu()).toBeNull();
  });

  it('offers the plain shell first, then only the Providers enabled in Settings', async () => {
    const { chosen, entries, press } = await setup(['OpenCode', 'ClaudeCode']);
    await press();
    expect(entries()).toEqual(['Shell', 'OpenCode', 'Claude Code']);
    expect(chosen).toEqual([]);
  });

  it('follows Settings: a Provider enabled later is offered', async () => {
    const { entries, press, providers, settle } = await setup(['OpenCode']);
    providers.set('Codex', true);
    await settle();
    await press();
    expect(entries()).toEqual(['Shell', 'OpenCode', 'Codex']);
  });

  it('opens a Terminal for the Provider that is chosen, and closes the picker', async () => {
    const { chosen, entry, menu, press, settle } = await setup(['OpenCode', 'ClaudeCode']);
    await press();
    entry('Claude Code').click();
    await settle();
    expect(chosen).toEqual(['ClaudeCode']);
    expect(menu()).toBeNull();
  });

  it('opens a plain shell when the shell is chosen', async () => {
    const { chosen, entry, press, settle } = await setup(['Codex']);
    await press();
    entry('Shell').click();
    await settle();
    expect(chosen).toEqual([undefined]);
  });

  it('closes without choosing on Escape, on a click elsewhere, and on pressing the button again', async () => {
    const { chosen, menu, press, settle } = await setup(['Codex']);
    await press();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(menu()).toBeNull();

    await press();
    document.body.click();
    await settle();
    expect(menu()).toBeNull();

    await press();
    await press();
    expect(menu()).toBeNull();
    expect(chosen).toEqual([]);
  });
});
