import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MessageComponent, MessageRole } from './message';
import type { Provider } from '../provider-icon/provider-icon';

@Component({
  imports: [MessageComponent],
  template: `<ui-message [role]="role" [author]="author" [provider]="provider"><p>Hello there</p></ui-message>`,
})
class Host {
  role: MessageRole = 'agent';
  author = '';
  provider: Provider | undefined = undefined;
}

describe('MessageComponent', () => {
  async function render(patch: Partial<Host> = {}) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('ui-message') as HTMLElement;
  }

  it('projects content and is an article named "Agent" by default', async () => {
    const el = await render();
    expect(el.getAttribute('role')).toBe('article');
    expect(el.getAttribute('aria-label')).toBe('Agent');
    expect(el.textContent).toContain('Hello there');
  });

  it('agent messages show an avatar', async () => {
    const el = await render();
    expect(el.querySelector('ui-avatar')).not.toBeNull();
  });

  it('shows the mark of the provider as the avatar when it is given', async () => {
    const el = await render({ provider: 'claude' });
    expect(el.querySelector('ui-avatar ui-provider-icon')).not.toBeNull();
  });

  it('user messages are named "You" and have no avatar', async () => {
    const el = await render({ role: 'user' });
    expect(el.getAttribute('aria-label')).toBe('You');
    expect(el.querySelector('ui-avatar')).toBeNull();
    expect(el.textContent).toContain('Hello there');
  });

  it('author overrides the accessible name', async () => {
    const el = await render({ author: 'Claude Code' });
    expect(el.getAttribute('aria-label')).toBe('Claude Code');
  });
});
