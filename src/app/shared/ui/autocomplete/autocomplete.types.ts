export interface AutocompleteOption<T = unknown> {
  readonly value: T;
  readonly label: string;
  readonly group?: string;
}
