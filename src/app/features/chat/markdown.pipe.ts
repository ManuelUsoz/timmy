import { Pipe, type PipeTransform } from '@angular/core';
import { marked } from 'marked';

/**
 * Markdown to HTML for model output. The result is bound with `[innerHTML]`, so
 * Angular's sanitizer strips scripts and unsafe attributes from it.
 */
@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  transform(text: string): string {
    return marked.parse(text, { async: false, gfm: true, breaks: true });
  }
}
