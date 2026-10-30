import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AskRowComponent } from './ask-row';

@Component({
  imports: [AskRowComponent],
  template: `<ui-ask-row title="api-gateway asks" [sub]="sub" (allow)="allowed = allowed + 1" (deny)="denied = denied + 1" />`,
})
class Host {
  sub: string | undefined = 'git push origin fix/rate-limit';
  allowed = 0;
  denied = 0;
}

describe('AskRowComponent', () => {
  async function render(patch: Partial<Host> = {}) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, host: fixture.componentInstance };
  }

  it('shows title and sub-text', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('api-gateway asks');
    expect(el.textContent).toContain('git push origin fix/rate-limit');
  });

  it('omits sub-text when absent', async () => {
    const { el } = await render({ sub: undefined });
    expect(el.textContent).not.toContain('git push');
  });

  it('exposes Allow and Deny as named buttons', async () => {
    const { el } = await render();
    const names = Array.from(el.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Deny: api-gateway asks', 'Allow: api-gateway asks']);
  });

  it('emits allow and deny', async () => {
    const { el, host } = await render();
    const [deny, allow] = Array.from(el.querySelectorAll('button'));
    allow.click();
    expect([host.allowed, host.denied]).toEqual([1, 0]);
    deny.click();
    expect([host.allowed, host.denied]).toEqual([1, 1]);
  });
});
