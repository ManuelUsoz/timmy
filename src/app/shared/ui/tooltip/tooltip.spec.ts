import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TooltipComponent } from './tooltip';

@Component({
  imports: [TooltipComponent],
  template: `<ui-tooltip text="src/app/main.ts"><button>main.ts</button></ui-tooltip>`,
})
class Host {}

describe('TooltipComponent', () => {
  async function render() {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return fixture;
  }
  const popup = (el: HTMLElement) => el.querySelector('[role="tooltip"]');

  it('is hidden until hover, then shows the text and describes the trigger', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    expect(popup(el)).toBeNull();

    el.querySelector('ui-tooltip')!.dispatchEvent(new Event('mouseenter'));
    await fixture.whenStable();
    expect(popup(el)?.textContent).toBe('src/app/main.ts');
    expect(el.querySelector('.as-tooltip__trigger')!.getAttribute('aria-describedby')).toBe(popup(el)!.id);

    el.querySelector('ui-tooltip')!.dispatchEvent(new Event('mouseleave'));
    await fixture.whenStable();
    expect(popup(el)).toBeNull();
  });

  it('shows on focus and hides on Escape', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    const host = el.querySelector('ui-tooltip')!;
    host.dispatchEvent(new Event('focusin'));
    await fixture.whenStable();
    expect(popup(el)).not.toBeNull();

    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(popup(el)).toBeNull();
  });
});

describe('TooltipComponent placement', () => {
  it('defaults to top and reflects the placement input', async () => {
    @Component({
      imports: [TooltipComponent],
      template: `<ui-tooltip text="x" placement="bottom"><b>a</b></ui-tooltip><ui-tooltip text="y"><b>b</b></ui-tooltip>`,
    })
    class Placed {}
    await TestBed.configureTestingModule({ imports: [Placed] }).compileComponents();
    const fixture = TestBed.createComponent(Placed);
    await fixture.whenStable();
    const hosts = fixture.nativeElement.querySelectorAll('ui-tooltip');
    expect(hosts[0].dataset['placement']).toBe('bottom');
    expect(hosts[1].dataset['placement']).toBe('top');
  });
});
