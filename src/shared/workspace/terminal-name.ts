import type { Provider } from '../settings/settings.model';

/** What each Provider's CLI is called on the user's PATH, which is also how its Terminals are named by default. */
export const providerCli: Readonly<Record<Provider, string>> = {
  OpenCode: 'opencode',
  ClaudeCode: 'claude',
  Codex: 'codex',
};

/** A Terminal's name until the user renames it: its Provider and number ("claude 2"), "shell 2" for a plain shell (GLOSSARY: Terminal). */
export const defaultTerminalName = (provider: Provider | undefined, number: number): string =>
  `${provider === undefined ? 'shell' : providerCli[provider]} ${number}`;

/** Names are unique within a Project ignoring case, and surrounding blanks are not part of a name. */
const nameKey = (name: string): string => name.trim().toLocaleLowerCase();

/** Whether `name` is already one of `taken` (the names of the Project's other Terminals), ignoring case. */
export const isTerminalNameTaken = (taken: ReadonlyArray<string>, name: string): boolean => {
  const key = nameKey(name);
  return taken.some((other) => nameKey(other) === key);
};

/**
 * The default name for a new Terminal. Numbers are never reused, so it is free unless the user gave that name to
 * another Terminal; then a suffix keeps it unique ("claude 3 (2)").
 */
export const freeDefaultName = (taken: ReadonlyArray<string>, provider: Provider | undefined, number: number): string => {
  const base = defaultTerminalName(provider, number);
  let name = base;
  for (let copy = 2; isTerminalNameTaken(taken, name); copy += 1) name = `${base} (${copy})`;
  return name;
};
