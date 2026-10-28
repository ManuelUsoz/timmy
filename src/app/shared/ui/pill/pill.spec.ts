import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PillComponent, PillTone } from './pill';

@Component({
  imports: [PillComponent],
  template: `<ui-pill [tone]="tone" [label]="'Runs'" [pulse]="pulse">Fix bug<span pillMeta>2m</span></ui-pill>`,
})
class Host {
  tone: PillTone = 'neutral';
  pulse = false;
}

describe('PillComponent', () => {
  async function render(tone?: PillTone, pulse = false) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    if (tone) fixture.componentInstance.tone = tone;
    fixture.componentInstance.pulse = pulse;
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('ui-pill') as HTMLElement;
  }

  it('is neutral by default, shows label, text and meta', async () => {
    const el = await render();
    expect(el.classList).toContain('as-pill--neutral');
    expect(el.querySelector('.as-pill__state')?.textContent).toContain('Runs');
    expect(el.querySelector('.as-pill__text')?.textContent).toContain('Fix bug');
    expect(el.querySelector('.as-pill__meta')?.textContent).toContain('2m');
    expect(el.classList).not.toContain('as-pill--pulse');
  });

  for (const tone of ['running', 'waiting', 'error', 'done'] as const) {
    it(`applies the ${tone} tone class`, async () => {
      const el = await render(tone);
      expect(el.classList).toContain(`as-pill--${tone}`);
    });
  }

  it('adds attn line only when waiting', async () => {
    expect((await render('waiting')).classList).toContain('as-pill--attn');
  });

  it('pulses when asked', async () => {
    expect((await render('running', true)).classList).toContain('as-pill--pulse');
  });
});
