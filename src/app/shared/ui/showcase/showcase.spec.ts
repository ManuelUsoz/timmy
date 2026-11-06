import { TestBed } from '@angular/core/testing';
import { ShowcaseComponent } from './showcase';

describe('ShowcaseComponent', () => {
  it('renders the Mascot in every status', async () => {
    await TestBed.configureTestingModule({ imports: [ShowcaseComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ShowcaseComponent);
    await fixture.whenStable();
    const statuses = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="mascot-statuses"] ui-mascot')).map((el) =>
      (el as HTMLElement).getAttribute('data-status'),
    );
    expect(statuses).toEqual(['Idle', 'Working', 'Waiting', 'Error', 'Done']);
  });

  it('turns a Mascot to any status, so the entry hops and the Waiting pulse can be checked', async () => {
    await TestBed.configureTestingModule({ imports: [ShowcaseComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ShowcaseComponent);
    await fixture.whenStable();
    const motion = fixture.nativeElement.querySelector('[data-testid="mascot-motion"]') as HTMLElement;
    const mascot = motion.querySelector('ui-mascot')!;
    expect(mascot.getAttribute('data-status')).toBe('Idle');
    const turnTo = Array.from(motion.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Waiting')!;
    turnTo.click();
    await fixture.whenStable();
    expect(mascot.getAttribute('data-status')).toBe('Waiting');
    expect(mascot.getAttribute('data-hop')).toBe('double');
  });
});
