import { TestBed } from '@angular/core/testing';
import { ChatViewComponent } from './chat-view';

describe('ChatViewComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatViewComponent],
    }).compileComponents();
  });

  it('creates the view', () => {
    const fixture = TestBed.createComponent(ChatViewComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the Timmy title', async () => {
    const fixture = TestBed.createComponent(ChatViewComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Timmy');
  });
});
