import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ProviderIconComponent, type Provider } from './provider-icon';

@Component({
  imports: [ProviderIconComponent],
  template: '<ui-provider-icon [provider]="provider" />',
})
class Host {
  provider: Provider = 'claude';
}

describe('ProviderIconComponent', () => {
  const render = async (provider: Provider) => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.provider = provider;
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it.each(['claude', 'openai', 'opencode'] as const)('draws the %s mark, hidden from assistive tech', async (provider) => {
    const svg = (await render(provider)).querySelector('ui-provider-icon svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.querySelectorAll('path')).toHaveLength(1);
  });

  it('keeps the Claude brand colour while the others follow the text colour', async () => {
    expect((await render('claude')).querySelector('path')?.getAttribute('fill')).toBe('#D97757');
    expect((await render('openai')).querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
  });
});
