import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  booleanAttribute,
  computed,
  forwardRef,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { StateComponent } from '../state/state';
import { TreeNode } from './tree-view.types';

export type TreeMode = 'single' | 'checkable';
export type TreeSize = 'default' | 'sm';
export type TreeVariant = 'default' | 'activity';
export type TreeCheckState = 'checked' | 'unchecked' | 'mixed';

interface TreeRow {
  readonly node: TreeNode;
  readonly depth: number;
  readonly parentId: string | null;
  readonly setSize: number;
  readonly posInSet: number;
  readonly expandable: boolean;
}

@Component({
  selector: 'ui-tree-view',
  templateUrl: './tree-view.html',
  styleUrl: './tree-view.css',
  imports: [NgTemplateOutlet, StateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TreeViewComponent), multi: true },
  ],
})
export class TreeViewComponent implements ControlValueAccessor {
  readonly nodes = input.required<readonly TreeNode[]>();
  readonly mode = input<TreeMode>('single');
  readonly size = input<TreeSize>('default');
  /** `activity` renders a read-only tool activity tree with nested groups. */
  readonly variant = input<TreeVariant>('default');
  /** The accessible name of the tree (default variant). */
  readonly label = input<string>();
  /** A folder also opens and closes when it is activated (click, Enter or Space), as in a file explorer. */
  readonly toggleOnActivate = input(false, { transform: booleanAttribute });
  readonly disabledInput = input(false, { alias: 'disabled', transform: booleanAttribute });

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly selectedId = signal<string | null>(null);
  protected readonly checkedIds = signal<ReadonlySet<string>>(new Set());
  /** The folders open now: those flagged `expanded` at first, then whatever the user toggles. */
  protected readonly expanded = linkedSignal<readonly TreeNode[], ReadonlySet<string>>({
    source: this.nodes,
    computation: (nodes) => {
      const open = new Set<string>();
      const walk = (list: readonly TreeNode[]): void => {
        for (const node of list) {
          if (node.expanded && node.children?.length) open.add(node.id);
          if (node.children) walk(node.children);
        }
      };
      walk(nodes);
      return open;
    },
  });
  private readonly activityOverrides = signal<ReadonlyMap<string, boolean>>(new Map());
  private readonly activeRaw = signal<string | null>(null);
  private readonly cvaDisabled = signal(false);
  protected readonly disabled = computed(() => this.disabledInput() || this.cvaDisabled());

  protected readonly rows = computed<TreeRow[]>(() => {
    const open = this.expanded();
    const out: TreeRow[] = [];
    const walk = (list: readonly TreeNode[], depth: number, parentId: string | null): void => {
      list.forEach((node, i) => {
        const expandable = !!node.children?.length;
        out.push({ node, depth, parentId, setSize: list.length, posInSet: i + 1, expandable });
        if (expandable && open.has(node.id)) walk(node.children!, depth + 1, node.id);
      });
    };
    walk(this.nodes(), 0, null);
    return out;
  });

  protected readonly activeId = computed(() => {
    const rows = this.rows();
    const cur = this.activeRaw();
    if (cur && rows.some((r) => r.node.id === cur)) return cur;
    return rows[0]?.node.id ?? null;
  });

  private onChange: (v: unknown) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    if (this.mode() === 'checkable') {
      this.checkedIds.set(new Set(Array.isArray(v) ? (v as string[]) : []));
    } else {
      this.selectedId.set(typeof v === 'string' ? v : null);
    }
  }
  registerOnChange(fn: (v: unknown) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.cvaDisabled.set(d);
  }

  private leaves(node: TreeNode): TreeNode[] {
    if (!node.children?.length) return [node];
    return node.children.flatMap((c) => this.leaves(c));
  }

  protected checkState(node: TreeNode): TreeCheckState {
    const leaves = this.leaves(node);
    const checked = this.checkedIds();
    const n = leaves.filter((l) => checked.has(l.id)).length;
    if (n === 0) return 'unchecked';
    return n === leaves.length ? 'checked' : 'mixed';
  }

  protected ariaChecked(node: TreeNode): string | null {
    if (this.mode() !== 'checkable') return null;
    const s = this.checkState(node);
    return s === 'mixed' ? 'mixed' : s === 'checked' ? 'true' : 'false';
  }

  protected ariaSelected(node: TreeNode): string | null {
    return this.mode() === 'single' ? String(this.selectedId() === node.id) : null;
  }

  protected toggleExpand(id: string, open?: boolean): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      const want = open ?? !next.has(id);
      if (want) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected activate(node: TreeNode): void {
    if (this.disabled() || node.disabled) return;
    if (this.mode() === 'single') {
      this.selectedId.set(node.id);
      this.onChange(node.id);
      return;
    }
    const leaves = this.leaves(node).filter((l) => !l.disabled);
    if (!leaves.length) return;
    const all = leaves.every((l) => this.checkedIds().has(l.id));
    const next = new Set(this.checkedIds());
    for (const l of leaves) {
      if (all) next.delete(l.id);
      else next.add(l.id);
    }
    this.checkedIds.set(next);
    this.onChange([...next]);
  }

  protected onRowClick(node: TreeNode): void {
    this.activeRaw.set(node.id);
    this.activate(node);
    this.toggleIfFolder(node);
  }

  private toggleIfFolder(node: TreeNode): void {
    if (this.toggleOnActivate() && node.children?.length) this.toggleExpand(node.id);
  }

  protected onChevron(event: Event, row: TreeRow): void {
    event.stopPropagation();
    this.activeRaw.set(row.node.id);
    this.toggleExpand(row.node.id);
  }

  private moveTo(id: string | undefined): void {
    if (!id) return;
    this.activeRaw.set(id);
    afterNextRender(
      () => {
        this.el.nativeElement
          .querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
          ?.focus();
      },
      { injector: this.injector },
    );
  }

  protected onKey(event: KeyboardEvent): void {
    const rows = this.rows();
    const id = this.activeId();
    const idx = rows.findIndex((r) => r.node.id === id);
    const row = rows[idx];
    if (!row) return;
    const open = this.expanded().has(row.node.id);
    switch (event.key) {
      case 'ArrowDown':
        this.moveTo(rows[Math.min(idx + 1, rows.length - 1)].node.id);
        break;
      case 'ArrowUp':
        this.moveTo(rows[Math.max(idx - 1, 0)].node.id);
        break;
      case 'Home':
        this.moveTo(rows[0].node.id);
        break;
      case 'End':
        this.moveTo(rows[rows.length - 1].node.id);
        break;
      case 'ArrowRight':
        if (row.expandable && !open) this.toggleExpand(row.node.id, true);
        else if (row.expandable) this.moveTo(rows[idx + 1]?.node.id);
        break;
      case 'ArrowLeft':
        if (row.expandable && open) this.toggleExpand(row.node.id, false);
        else this.moveTo(row.parentId ?? undefined);
        break;
      case 'Enter':
      case ' ':
        this.activate(row.node);
        this.toggleIfFolder(row.node);
        break;
      case '*': {
        const siblings = rows.filter((r) => r.parentId === row.parentId && r.expandable);
        this.expanded.update((s) => {
          const next = new Set(s);
          siblings.forEach((r) => next.add(r.node.id));
          return next;
        });
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  }

  protected isOpen(node: TreeNode): boolean {
    return this.activityOverrides().get(node.id) ?? node.expanded ?? false;
  }

  protected toggleActivity(node: TreeNode): void {
    if (!node.children?.length) return;
    const open = !this.isOpen(node);
    this.activityOverrides.update((m) => new Map(m).set(node.id, open));
  }

  protected onActivityKey(event: KeyboardEvent, node: TreeNode): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggleActivity(node);
  }

  protected touched(): void {
    this.onTouched();
  }
}
