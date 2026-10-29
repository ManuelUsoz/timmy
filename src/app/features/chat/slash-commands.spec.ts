import { describe, expect, it } from 'vitest';
import type { SlashCommand } from '../../../shared/chat/command.model';
import { applyCommand, filterCommands, slashQuery } from './slash-commands';

const command = (name: string): SlashCommand => ({ name, description: '', argumentHint: '' });
const COMMANDS = ['help', 'compact', 'clear', 'recap'].map(command);

describe('slashQuery', () => {
  it('returns the word after a leading slash', () => {
    expect(slashQuery('/he', 3)).toBe('he');
    expect(slashQuery('/', 1)).toBe('');
  });

  it('only looks before the caret', () => {
    expect(slashQuery('/help', 3)).toBe('he');
  });

  it('is undefined outside the first word or without a leading slash', () => {
    expect(slashQuery('hello /he', 9)).toBeUndefined();
    expect(slashQuery('/help me', 8)).toBeUndefined();
    expect(slashQuery('', 0)).toBeUndefined();
  });
});

describe('filterCommands', () => {
  it('lists everything for an empty query', () => {
    expect(filterCommands(COMMANDS, '')).toEqual(COMMANDS);
  });

  it('puts prefix matches before substring matches, ignoring case', () => {
    expect(filterCommands(COMMANDS, 'C').map((c) => c.name)).toEqual(['compact', 'clear', 'recap']);
  });

  it('is empty when nothing matches', () => {
    expect(filterCommands(COMMANDS, 'zzz')).toEqual([]);
  });
});

describe('applyCommand', () => {
  it('replaces the typed query with the command and a trailing space', () => {
    expect(applyCommand('/he', 3, command('help'))).toEqual({ text: '/help ', caret: 6 });
  });

  it('keeps the text after the caret without doubling the space', () => {
    expect(applyCommand('/he foo', 3, command('help'))).toEqual({ text: '/help foo', caret: 6 });
  });
});
