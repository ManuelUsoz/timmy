import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  booleanAttribute,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { AutocompleteOption } from './autocomplete.types';

export type AutocompleteVariant = 'default' | 'search';

interface Row {
  opt: AutocompleteOption;
  index: number;
  id: string;
  create: boolean;
  before: string;
  match: string;
  after: string;
}
interface RowGroup {
  label: string | null;
  labelId: string;
  items: Row[];
}

const DEBOUNCE_MS = 100;
let nextId = 0;

@Component({
  selector: 'ui-autocomplete',
  templateUrl: './autocomplete.html',
  styleUrl: './autocomplete.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AutocompleteComponent), multi: true },
  ],
})
export class AutocompleteComponent implements ControlValueAccessor {
  readonly options = input<AutocompleteOption[]>([]);
  readonly multiple = input(false, { transform: booleanAttribute });
  readonly creatable = input(false, { transform: booleanAttribute });
  readonly loading = input(false, { transform: booleanAttribute });
  readonly variant = input<AutocompleteVariant>('default');
  readonly placeholder = input('');
  readonly label = input('');
  readonly helper = input('');
  readonly error = input<string | null>(null);

  protected readonly value = signal<unknown>(null);
  protected readonly inputText = signal('');
  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly activeIndex = signal(-1);
  protected readonly disabled = signal(false);
  private readonly created = signal<AutocompleteOption[]>([]);

  protected readonly uid = `ui-autocomplete-${nextId++}`;
  protected readonly inputId = `${this.uid}-input`;
  protected readonly listId = `${this.uid}-list`;
  protected readonly helpId = `${this.uid}-help`;

  private onChange: (v: unknown) => void = () => {};
  private onTouched: () => void = () => {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: string | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  private readonly allOptions = computed(() => [...this.options(), ...this.created()]);

  protected readonly selected = computed<AutocompleteOption[]>(() => {
    const v = this.value();
    const all = this.allOptions();
    if (this.multiple()) {
      const arr = Array.isArray(v) ? v : [];
      return arr.map((x) => all.find((o) => o.value === x) ?? { value: x, label: String(x) });
    }
    if (v === null || v === undefined) return [];
    return [all.find((o) => o.value === v) ?? { value: v, label: String(v) }];
  });

  private readonly typed = computed(() => this.query().trim());

  protected readonly groups = computed<RowGroup[]>(() => {
    const q = this.typed().toLowerCase();
    const groups: RowGroup[] = [];
    const byName = new Map<string, RowGroup>();
    for (const opt of this.allOptions()) {
      const at = q ? opt.label.toLowerCase().indexOf(q) : -1;
      if (q && at < 0) continue;
      const name = opt.group ?? '';
      let g = byName.get(name);
      if (!g) {
        g = {
          label: opt.group ?? null,
          labelId: `${this.uid}-grp-${groups.length}`,
          items: [],
        };
        byName.set(name, g);
        groups.push(g);
      }
      g.items.push({
        opt,
        index: -1,
        id: '',
        create: false,
        before: q ? opt.label.slice(0, at) : opt.label,
        match: q ? opt.label.slice(at, at + q.length) : '',
        after: q ? opt.label.slice(at + q.length) : '',
      });
    }
    let index = 0;
    for (const g of groups) {
      for (const row of g.items) {
        row.index = index;
        row.id = `${this.uid}-opt-${index}`;
        index++;
      }
    }
    return groups;
  });

  protected readonly items = computed(() => this.groups().flatMap((g) => g.items));

  protected readonly createRow = computed<Row | null>(() => {
    const text = this.typed();
    if (!this.creatable() || !text) return null;
    const exact = this.allOptions().some((o) => o.label.toLowerCase() === text.toLowerCase());
    if (exact) return null;
    const index = this.items().length;
    return {
      opt: { value: text, label: text },
      index,
      id: `${this.uid}-opt-${index}`,
      create: true,
      before: text,
      match: '',
      after: '',
    };
  });

  private readonly rows = computed(() => {
    const c = this.createRow();
    return c ? [...this.items(), c] : this.items();
  });

  protected readonly count = computed(() => this.items().length);

  protected readonly announcement = computed(() => {
    if (!this.open() || this.loading()) return '';
    const n = this.count();
    return n === 0 ? 'No results' : n === 1 ? '1 result' : `${n} results`;
  });

  protected readonly activeId = computed(() => {
    const i = this.activeIndex();
    return this.open() && i >= 0 && i < this.rows().length ? `${this.uid}-opt-${i}` : null;
  });

  protected readonly hasValue = computed(() => this.selected().length > 0 || this.inputText() !== '');

  writeValue(v: unknown): void {
    if (this.multiple()) {
      this.value.set(Array.isArray(v) ? v : []);
      this.inputText.set('');
    } else {
      this.value.set(v ?? null);
      this.inputText.set(this.selected()[0]?.label ?? '');
    }
    this.setQuery('');
  }
  registerOnChange(fn: (v: unknown) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.disabled.set(d);
    if (d) this.open.set(false);
  }

  protected isSelected(opt: AutocompleteOption): boolean {
    const v = this.value();
    return this.multiple() ? Array.isArray(v) && v.includes(opt.value) : v === opt.value;
  }

  private setQuery(q: string): void {
    clearTimeout(this.timer);
    this.pending = null;
    this.query.set(q);
    this.activeIndex.set(this.rows().length ? 0 : -1);
  }

  protected onInput(event: Event): void {
    if (this.disabled()) return;
    const raw = (event.target as HTMLInputElement).value;
    this.inputText.set(raw);
    this.open.set(true);
    clearTimeout(this.timer);
    this.pending = raw;
    this.timer = setTimeout(() => this.flushQuery(), DEBOUNCE_MS);
  }

  private flushQuery(): void {
    clearTimeout(this.timer);
    if (this.pending === null) return;
    const raw = this.pending;
    this.pending = null;
    if (raw === this.query()) return;
    this.query.set(raw);
    this.activeIndex.set(this.rows().length ? 0 : -1);
  }

  protected toggle(): void {
    if (this.disabled()) return;
    if (this.open()) this.open.set(false);
    else this.openMenu();
  }

  protected openMenu(): void {
    if (this.disabled()) return;
    if (!this.open()) {
      const cur = this.items().find((i) => this.isSelected(i.opt));
      this.activeIndex.set(cur ? cur.index : this.rows().length ? 0 : -1);
    }
    this.open.set(true);
  }

  pick(row: Row): void {
    if (this.disabled()) return;
    if (row.create) this.created.update((l) => [...l, row.opt]);
    if (this.multiple()) {
      const cur = Array.isArray(this.value()) ? (this.value() as unknown[]) : [];
      const next = cur.includes(row.opt.value)
        ? cur.filter((v) => v !== row.opt.value)
        : [...cur, row.opt.value];
      this.value.set(next);
      this.inputText.set('');
      this.setQuery('');
      this.onChange(next);
    } else {
      this.value.set(row.opt.value);
      this.inputText.set(row.opt.label);
      this.setQuery('');
      this.open.set(false);
      this.onChange(row.opt.value);
    }
  }

  removeChip(opt: AutocompleteOption): void {
    if (this.disabled()) return;
    const next = ((this.value() as unknown[]) ?? []).filter((v) => v !== opt.value);
    this.value.set(next);
    this.onChange(next);
  }

  clear(): void {
    if (this.disabled()) return;
    const next = this.multiple() ? [] : null;
    this.value.set(next);
    this.inputText.set('');
    this.setQuery('');
    this.onChange(next);
  }

  protected onBlur(): void {
    this.open.set(false);
    if (!this.multiple()) this.inputText.set(this.selected()[0]?.label ?? '');
    else this.inputText.set('');
    this.setQuery('');
    this.onTouched();
  }

  private move(dir: 1 | -1): void {
    const n = this.rows().length;
    if (!n) return;
    this.activeIndex.set((this.activeIndex() + dir + n) % n);
  }

  protected onKeydown(e: KeyboardEvent): void {
    if (this.disabled()) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (!this.open()) this.openMenu();
        else this.move(e.key === 'ArrowDown' ? 1 : -1);
        return;
      case 'Enter': {
        if (!this.open()) return;
        this.flushQuery();
        const row = this.rows()[this.activeIndex()];
        if (row) {
          e.preventDefault();
          this.pick(row);
        }
        return;
      }
      case 'Escape':
        if (this.open()) {
          e.preventDefault();
          this.open.set(false);
        } else if (this.inputText() || this.query()) {
          e.preventDefault();
          this.inputText.set('');
          this.setQuery('');
        }
        return;
      case 'Backspace': {
        if (!this.multiple() || this.inputText() !== '') return;
        const sel = this.selected();
        if (sel.length) {
          e.preventDefault();
          this.removeChip(sel[sel.length - 1]);
        }
        return;
      }
    }
  }
}
