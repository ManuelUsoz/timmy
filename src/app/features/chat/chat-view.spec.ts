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

  it('shows the state of the session next to the title', async () => {
    const fixture = TestBed.createComponent(ChatViewComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.title ui-state')?.textContent).toContain('Idle');
  });

  it('puts model, effort and permission in the composer, not above the transcript', async () => {
    const fixture = TestBed.createComponent(ChatViewComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.composer ui-model-picker')).toHaveLength(1);
    const permissions = compiled.querySelectorAll('.composer ui-select');
    expect(permissions).toHaveLength(1);
    expect(permissions[0].querySelector('.as-field__label')?.textContent?.trim()).toBe('Permisos');
    expect(permissions[0].querySelector('[data-variant="inline"]')).not.toBeNull();
    expect(compiled.querySelectorAll('ui-select')).toHaveLength(1);
  });

  it('shows an icon for each permission mode', async () => {
    const fixture = TestBed.createComponent(ChatViewComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.composer ui-select .as-select__trigger .as-select__icon')).not.toBeNull();
    compiled.querySelector<HTMLButtonElement>('.composer ui-select .as-select__trigger')!.click();
    await fixture.whenStable();
    expect(compiled.querySelectorAll('.composer ui-select .as-option .as-option__icon')).toHaveLength(4);
  });
});
