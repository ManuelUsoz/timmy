export interface SelectOption<T = unknown> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectGroup<T = unknown> {
  label: string;
  options: SelectOption<T>[];
}
