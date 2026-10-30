import { Component } from '@angular/core';
import { ShellComponent } from './features/shell/shell';

@Component({
  imports: [ShellComponent],
  selector: 'app-root',
  template: '<app-shell />',
  styles: ':host { display: block; }',
})
export class App {}
