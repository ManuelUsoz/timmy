import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StateComponent, StateTone } from './state';

@Component({
  imports: [StateComponent],
  template: `<ui-state [tone]="tone">Merged</ui-state>`,
})
class Host {
  tone: StateTone = 'idle';
}

describe('StateComponent', () => {
  async function render(tone?: StateTone) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    if (tone) fixture.componentInstance.tone = tone;
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('ui-state') as HTMLElement;
  }

  it('defaults to idle and renders dot plus word', async () => {
    const el = await render();
    expect(el.style.getPropertyValue('--tone')).toBe('var(--support-idle)');
    expect(el.querySelector('.as-dot')).not.toBeNull();
    expect(el.textContent).toContain('Merged');
  });

  it('sets --tone from the tone input', async () => {
    const el = await render('error');
    expect(el.style.getPropertyValue('--tone')).toBe('var(--support-error)');
  });
});
