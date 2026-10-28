import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AvatarComponent, AvatarSize, AvatarTone } from './avatar';

@Component({
  imports: [AvatarComponent],
  template: `<ui-avatar [name]="name" [initials]="initials" [tone]="tone" [size]="size" />`,
})
class Host {
  name = '';
  initials = '';
  tone: AvatarTone = 'merged';
  size: AvatarSize = 'default';
}

describe('AvatarComponent', () => {
  async function render(patch: Partial<Host> = {}) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('ui-avatar') as HTMLElement;
  }

  it('computes initials from up to two words', async () => {
    const el = await render({ name: 'ada king lovelace' });
    expect(el.querySelector('.as-avatar__text')?.textContent?.trim()).toBe('AK');
  });

  it('uses the initials override', async () => {
    const el = await render({ name: 'Ada King', initials: 'Z' });
    expect(el.querySelector('.as-avatar__text')?.textContent?.trim()).toBe('Z');
  });

  it('sets the tone variable', async () => {
    const el = await render({ tone: 'success' });
    expect(el.style.getPropertyValue('--tone')).toBe('var(--support-success)');
  });

  it('labels as image when named', async () => {
    const el = await render({ name: 'Ada' });
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Ada');
  });

  it('has no role without a name', async () => {
    const el = await render();
    expect(el.getAttribute('role')).toBeNull();
  });
});
