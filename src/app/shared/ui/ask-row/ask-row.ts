import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonComponent } from '../button/button';

@Component({
  selector: 'ui-ask-row',
  imports: [ButtonComponent],
  templateUrl: './ask-row.html',
  styleUrl: './ask-row.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AskRowComponent {
  readonly title = input.required<string>();
  readonly sub = input<string>();
  readonly allow = output<void>();
  readonly deny = output<void>();
}
