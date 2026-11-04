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
});
