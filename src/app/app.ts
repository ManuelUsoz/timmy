import { Component } from '@angular/core';
import { ChatViewComponent } from './features/chat/chat-view';

@Component({
  imports: [ChatViewComponent],
  selector: 'app-root',
  template: '<app-chat-view />',
  styles: ':host { display: block; }',
})
export class App {}
