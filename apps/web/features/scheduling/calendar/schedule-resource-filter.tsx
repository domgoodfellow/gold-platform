'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ListFilter } from 'lucide-react';
import { Checkbox } from '@gold/ui/components/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@gold/ui/components/popover';
import { Button } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { FOCUS_RING, cx } from '@/components/class-names';
import { scheduleHref, type ScheduleView } from './schedule-url';

/**
 * Which Resources the Day and Week bodies draw. A Popover at every width — it never claims a
 * permanent rail, so it costs a schedule nothing on a phone and needs no separate narrow variant.
 *
 * The selection is the URL's `resource` parameter, never a database row (this is view state, not
 * a saved filter): an empty selection means every Resource, so unchecking the last box a business
 * has and checking every other one both collapse back to no parameter at all, and checking every
 * box by hand lands on exactly the same address as never having touched the filter.
 */
export function ScheduleResourceFilter({
  organizationId,
  view,
  date,
  resources,
  selectedIds,
}: {
  organizationId: string;
  view: ScheduleView;
  date: string;
  resources: { id: string; name: string }[];
  selectedIds: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();

  const showingAll = selectedIds.length === 0;
  const visible = query.trim()
    ? resources.filter((resource) => resource.name.toLowerCase().includes(query.trim().toLowerCase()))
    : resources;

  const navigate = (resourceIds: string[]) => {
    router.push(scheduleHref(organizationId, { view, date, resourceIds }));
  };

  const toggle = (id: string) => {
    if (showingAll) {
      // Unchecking one Resource while every Resource is showing narrows to everyone else.
      navigate(resources.map((resource) => resource.id).filter((candidate) => candidate !== id));
      return;
    }
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Checking the last missing box is the same address as never having filtered.
    navigate(next.size === resources.length ? [] : [...next]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" tone="secondary" size="small" className={cx(FOCUS_RING, 'gap-1.5')}>
          <ListFilter aria-hidden size={14} />
          {showingAll ? 'All resources' : `${selectedIds.length} resource${selectedIds.length === 1 ? '' : 's'}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="border-b border-border p-2">
          <span className="block px-1 pb-1.5 text-xs font-medium uppercase tracking-wide text-subtle">
            Resources
          </span>
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search resources…"
            aria-label="Search resources"
            size="small"
          />
        </div>

        {resources.length > 1 ? (
          <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-sm">
            <button type="button" className={cx(FOCUS_RING, 'rounded underline underline-offset-4')} onClick={() => navigate([])}>
              Select all
            </button>
            <button type="button" className={cx(FOCUS_RING, 'rounded underline underline-offset-4')} onClick={() => navigate([])}>
              Clear
            </button>
          </div>
        ) : null}

        <div className="max-h-64 overflow-y-auto p-2">
          {resources.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted">No resources yet.</p>
          ) : visible.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted">No resource matches “{query.trim()}”.</p>
          ) : (
            visible.map((resource) => {
              const checked = showingAll || selectedIds.includes(resource.id);
              const inputId = `schedule-resource-${resource.id}`;
              return (
                <div key={resource.id} className="flex items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-hover">
                  <Checkbox id={inputId} checked={checked} onCheckedChange={() => toggle(resource.id)} />
                  <label htmlFor={inputId} className={cx(FOCUS_RING, 'min-w-0 flex-1 cursor-pointer truncate rounded')}>
                    {resource.name}
                  </label>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
