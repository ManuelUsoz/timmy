export interface SelectOption<T = unknown> {
  value: T;
  label: string;
  disabled?: boolean;
  /** SVG path data on a 16x16 grid (stroked, no fill); drawn before the label in the list and in the trigger. */
  icon?: string;
}

export interface SelectGroup<T = unknown> {
  label: string;
  options: SelectOption<T>[];
}
