import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TagComponent, TagTone } from './tag';

@Component({
  imports: [TagComponent],
  template: `<ui-tag [tone]="tone">Beta</ui-tag>`,
})
class Host {
  tone: TagTone = 'gray';
}

describe('TagComponent', () => {
  async function render(tone?: TagTone) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    if (tone) fixture.componentInstance.tone = tone;
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('ui-tag') as HTMLElement;
  }

  it('is gray by default and projects the label', async () => {
    const el = await render();
    expect(el.classList).toContain('as-tag');
    expect(el.className).not.toContain('as-tag--');
    expect(el.textContent).toContain('Beta');
  });

  it('applies the tone class', async () => {
    const el = await render('green');
    expect(el.classList).toContain('as-tag--green');
  });
});
