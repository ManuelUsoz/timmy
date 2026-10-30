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

  it('shows the session title with the Claude Code tag', async () => {
    const fixture = TestBed.createComponent(ChatViewComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.title-name')?.textContent).toContain('New session');
    expect(compiled.querySelector('ui-tag')?.textContent).toContain('Claude Code');
  });

  it('puts model, effort and permission in the composer, not above the transcript', async () => {
    const fixture = TestBed.createComponent(ChatViewComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const inComposer = Array.from(compiled.querySelectorAll('.composer ui-select')).map((s) =>
      s.querySelector('.as-field__label')?.textContent?.trim(),
    );
    expect(inComposer).toEqual(['Model', 'Effort', 'Permission']);
    expect(compiled.querySelectorAll('ui-select')).toHaveLength(3);
  });
});
