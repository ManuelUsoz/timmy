import type { TreeNode } from '../../shared/ui/tree-view/tree-view.types';

/**
 * STATIC placeholder tree copied from the design: there is no filesystem behind Archivos yet, so every project
 * shows the same one. The future feature replaces it; nothing here is read from disk or stored.
 */
export const sampleFiles = (modifiedLabel: string): readonly TreeNode[] => [
  {
    id: 'src',
    label: 'src',
    kind: 'folder',
    expanded: true,
    children: [
      {
        id: 'src/app',
        label: 'app',
        kind: 'folder',
        expanded: true,
        children: [
          { id: 'src/app/core', label: 'core', kind: 'folder', children: [{ id: 'src/app/core/i18n.ts', label: 'i18n.ts', kind: 'file' }] },
          { id: 'src/app/features', label: 'features', kind: 'folder', children: [{ id: 'src/app/features/chat', label: 'chat', kind: 'folder', children: [{ id: 'src/app/features/chat/chat-view.ts', label: 'chat-view.ts', kind: 'file' }] }] },
        ],
      },
    ],
  },
  { id: 'electron', label: 'electron', kind: 'folder', children: [{ id: 'electron/main.ts', label: 'main.ts', kind: 'file' }] },
  { id: 'node_modules', label: 'node_modules', kind: 'folder', dimmed: true, children: [{ id: 'node_modules/effect', label: 'effect', kind: 'folder', dimmed: true }] },
  { id: 'CLAUDE.md', label: 'CLAUDE.md', kind: 'file' },
  { id: 'package.json', label: 'package.json', kind: 'file', flag: { text: 'M', label: modifiedLabel } },
];
