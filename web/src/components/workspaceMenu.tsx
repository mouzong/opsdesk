import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import type { Workspace } from '../../../shared/types';
import { useStore } from '../store';
import type { MenuItem } from './ui';

/** Management actions for a workspace; shared by the sidebar and the workspace-selection screen. */
export function useWorkspaceMenu() {
  const { openDialog, actions, run } = useStore();
  return (w: Workspace, i: number, all: Workspace[]): MenuItem[] => [
    { label: 'Edit name and icon...', icon: <Pencil size={16} />, onSelect: () => openDialog({ type: 'name', kind: 'workspace-edit', id: w.id }) },
    { label: 'Move up', icon: <ArrowUp size={16} />, disabled: i === 0, onSelect: () => void run(() => actions.moveWorkspace(w.id, i - 1)) },
    { label: 'Move down', icon: <ArrowDown size={16} />, disabled: i === all.length - 1, onSelect: () => void run(() => actions.moveWorkspace(w.id, i + 1)) },
    { label: 'Delete workspace...', icon: <Trash2 size={16} />, danger: true, separatorBefore: true, onSelect: () => openDialog({ type: 'delete-structure', kind: 'workspace', id: w.id }) },
  ];
}
