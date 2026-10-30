import { TestBed } from '@angular/core/testing';
import { EffectRuntime } from '../../core/effect-runtime';
import { fakeRuntime, makeBackend } from '../workspace/projects-fakes';
import { ChatStopped } from './chat-stopped';

const setup = async (offerNewSession: boolean) => {
  await TestBed.configureTestingModule({
    imports: [ChatStopped],
    providers: [{ provide: EffectRuntime, useValue: fakeRuntime(makeBackend()) }],
  }).compileComponents();
  const fixture = TestBed.createComponent(ChatStopped);
  fixture.componentRef.setInput('detail', 'SDK_TIMEOUT');
  fixture.componentRef.setInput('offerNewSession', offerNewSession);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
};

describe('ChatStopped', () => {
  it('says the session stopped and shows what the chat knows of the failure', async () => {
    const el = await setup(true);
    expect(el.querySelector('[role=alert] .title')?.textContent).toBe('La sesión se detuvo');
    expect(el.querySelector('.detail')?.textContent).toBe('SDK_TIMEOUT');
  });

  it('offers a new session only where there is a project to start it in', async () => {
    const names = (el: HTMLElement) => Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(names(await setup(true))).toEqual(['Nueva sesión', 'Copiar detalle']);
    TestBed.resetTestingModule();
    expect(names(await setup(false))).toEqual(['Copiar detalle']);
  });
});
