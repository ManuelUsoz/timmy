import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  forwardRef,
  inject,
  input,
  signal,
  viewChild,
  booleanAttribute,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { SelectGroup, SelectOption } from './select.types';

export type SelectSize = 'sm' | 'md' | 'lg';
export type SelectDisplay = 'count' | 'chips';

interface IndexedOption {
  opt: SelectOption;
  index: number;
  id: string;
}
interface IndexedGroup {
  label: string | null;
  labelId: string;
  items: IndexedOption[];
}

let nextId = 0;

@Component({
  selector: 'ui-select',
  templateUrl: './select.html',
  styleUrl: './select.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectComponent), multi: true },
  ],
  host: {
    class: 'as-select-host',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
  },
})
export class SelectComponent implements ControlValueAccessor {
  readonly options = input<(SelectOption | SelectGroup)[]>([]);
  readonly multiple = input(false, { transform: booleanAttribute });
  readonly display = input<SelectDisplay>('count');
  readonly size = input<SelectSize>('md');
  readonly label = input('');
  readonly helper = input('');
  readonly placeholder = input('Select');
  readonly error = input('');

  protected readonly value = signal<unknown>(null);
  protected readonly open = signal(false);
  protected readonly activeIndex = signal(-1);
  protected readonly disabled = signal(false);

  protected readonly uid = `ui-select-${nextId++}`;
  protected readonly labelId = `${this.uid}-label`;
  protected readonly listId = `${this.uid}-list`;
  protected readonly helpId = `${this.uid}-help`;

  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private onChange: (v: unknown) => void = () => {};
  private onTouched: () => void = () => {};
  private typeBuffer = '';
  private typeTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly groups = computed<IndexedGroup[]>(() => {
    let index = 0;
    const groups: IndexedGroup[] = [];
    const flat: IndexedOption[] = [];
    const make = (opt: SelectOption): IndexedOption => {
      const i = index++;
      return { opt, index: i, id: `${this.uid}-opt-${i}` };
    };
    this.options().forEach((o, gi) => {
      if ('options' in o) {
        groups.push({
          label: o.label,
          labelId: `${this.uid}-grp-${gi}`,
          items: o.options.map(make),
        });
      } else {
        flat.push(make(o));
      }
    });
    if (flat.length) groups.unshift({ label: null, labelId: '', items: flat });
    return groups;
  });

  protected readonly flat = computed(() => this.groups().flatMap((g) => g.items));

  protected readonly selected = computed<SelectOption[]>(() => {
    const v = this.value();
    const all = this.flat().map((i) => i.opt);
    if (this.multiple()) {
      const arr = Array.isArray(v) ? v : [];
      return all.filter((o) => arr.includes(o.value));
    }
    return all.filter((o) => o.value === v).slice(0, 1);
  });

  protected readonly activeId = computed(() => {
    const i = this.activeIndex();
    return this.open() && i >= 0 ? `${this.uid}-opt-${i}` : null;
  });

  writeValue(v: unknown): void {
    this.value.set(this.multiple() ? (Array.isArray(v) ? v : []) : (v ?? null));
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

  protected isSelected(opt: SelectOption): boolean {
    const v = this.value();
    return this.multiple() ? Array.isArray(v) && v.includes(opt.value) : v === opt.value;
  }

  toggle(): void {
    if (this.disabled()) return;
    if (this.open()) this.close();
    else this.openMenu();
  }

  private openMenu(): void {
    if (this.disabled()) return;
    const flat = this.flat();
    const sel = flat.find((i) => this.isSelected(i.opt) && !i.opt.disabled);
    const first = sel ?? flat.find((i) => !i.opt.disabled);
    this.activeIndex.set(first ? first.index : -1);
    this.open.set(true);
  }

  private close(refocus = false): void {
    if (this.open()) {
      this.open.set(false);
      this.onTouched();
    }
    if (refocus) this.trigger()?.nativeElement.focus();
  }

  select(opt: SelectOption): void {
    if (opt.disabled || this.disabled()) return;
    if (this.multiple()) {
      const cur = (this.value() as unknown[]) ?? [];
      const next = cur.includes(opt.value) ? cur.filter((v) => v !== opt.value) : [...cur, opt.value];
      this.value.set(next);
      this.onChange(next);
    } else {
      this.value.set(opt.value);
      this.onChange(opt.value);
      this.close(true);
    }
  }

  clearAll(event?: Event): void {
    event?.stopPropagation();
    if (this.disabled()) return;
    this.value.set([]);
    this.onChange([]);
  }

  removeChip(opt: SelectOption, event?: Event): void {
    event?.stopPropagation();
    if (this.disabled()) return;
    const next = ((this.value() as unknown[]) ?? []).filter((v) => v !== opt.value);
    this.value.set(next);
    this.onChange(next);
  }

  protected onBlur(): void {
    if (!this.open()) this.onTouched();
  }

  protected onDocumentPointerDown(e: Event): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.close();
  }

  private move(dir: 1 | -1): void {
    const flat = this.flat();
    if (!flat.length) return;
    let i = this.activeIndex();
    for (let n = 0; n < flat.length; n++) {
      i = (i + dir + flat.length) % flat.length;
      if (!flat[i].opt.disabled) {
        this.activeIndex.set(i);
        return;
      }
    }
  }

  protected onTriggerKeydown(e: KeyboardEvent): void {
    if (this.disabled()) return;
    const isOpen = this.open();
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (!isOpen) this.openMenu();
        else this.move(e.key === 'ArrowDown' ? 1 : -1);
        return;
      case 'Enter':
      case ' ': {
        if (e.key === ' ' && this.typeBuffer) break;
        e.preventDefault();
        if (!isOpen) {
          this.openMenu();
          return;
        }
        const item = this.flat()[this.activeIndex()];
        if (item) this.select(item.opt);
        return;
      }
      case 'Escape':
        if (isOpen) {
          e.preventDefault();
          this.close(true);
        }
        return;
      case 'Tab':
        this.close();
        return;
      case 'Backspace':
      case 'Delete': {
        if (!this.multiple()) return;
        const sel = this.selected();
        if (!sel.length) return;
        e.preventDefault();
        if (this.display() === 'chips') this.removeChip(sel[sel.length - 1]);
        else this.clearAll();
        return;
      }
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.typeahead(e.key);
    }
  }

  private typeahead(ch: string): void {
    clearTimeout(this.typeTimer);
    this.typeBuffer += ch.toLowerCase();
    this.typeTimer = setTimeout(() => (this.typeBuffer = ''), 500);
    const flat = this.flat();
    const start = Math.max(this.activeIndex(), 0);
    const ordered = [...flat.slice(start), ...flat.slice(0, start)];
    // Search starts at the active item and wraps; the buffer prefix (within 500ms) must match.
    const hit = ordered.find(
      (i) => !i.opt.disabled && i.opt.label.toLowerCase().startsWith(this.typeBuffer),
    );
    if (!hit) return;
    if (!this.open()) this.open.set(true);
    this.activeIndex.set(hit.index);
  }
}
