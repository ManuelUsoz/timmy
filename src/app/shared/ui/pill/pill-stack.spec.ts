import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AvatarComponent } from '../avatar/avatar';
import { PillStackComponent } from './pill-stack';

@Component({
  imports: [PillStackComponent, AvatarComponent],
  template: `<ui-pill-stack>
    <ui-avatar name="A" /><ui-avatar name="B" /><ui-avatar name="C" /><ui-avatar name="D" />
  </ui-pill-stack>`,
})
class Host {}

describe('PillStackComponent', () => {
  it('projects avatars inside the overlap stack', async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const stack = fixture.nativeElement.querySelector('ui-pill-stack') as HTMLElement;
    expect(stack.classList).toContain('as-stack');
    expect(stack.querySelectorAll('ui-avatar').length).toBe(4);
  });
});
