'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icons } from '@/components/icons';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TASK_VIEW_VALUES, type TaskView } from '../utils/task-view';

export { TASK_VIEW_VALUES, type TaskView };

const VIEW_CONFIG: Record<TaskView, { label: string; icon: keyof typeof Icons }> = {
  list: { label: 'List', icon: 'dots' },
  board: { label: 'Board', icon: 'kanban' },
  calendar: { label: 'Calendar', icon: 'calendar' },
  timeline: { label: 'Timeline', icon: 'clock' },
  day: { label: 'My Day', icon: 'sun' }
};

export function TaskViewToggle({ view }: { view: TaskView }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setView(next: TaskView) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'list') {
      params.delete('view');
    } else {
      params.set('view', next);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  // Five view names do not fit across a phone. This was previously a wrapping row of buttons,
  // which on a narrow screen broke into three ragged lines and stopped reading as one control.
  // SegmentedControl is the app's existing answer to the same problem (see its own notes): a
  // single track that scrolls sideways within its own box, with the selection as one moving pill.
  const items = TASK_VIEW_VALUES.map((value) => {
    const Icon = Icons[VIEW_CONFIG[value].icon];
    return { value, label: VIEW_CONFIG[value].label, icon: <Icon /> };
  });

  return (
    <SegmentedControl
      items={items}
      value={view}
      onValueChange={(next) => setView(next as TaskView)}
      label='Task view'
    />
  );
}
