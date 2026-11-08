'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { CircleCheck } from 'lucide-react';
import { FOCUS_RING } from '@/components/class-names';
import { setupStepHref, type SetupStep } from './setup-guide';

/** Keep the current step visible inside the phone's contained navigation strip. */
export function SetupStepNavigation({ organizationId, steps, selectedKey }: { organizationId: string; steps: SetupStep[]; selectedKey: string }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const container = list.current;
    const current = container?.querySelector<HTMLElement>('[aria-current="step"]');
    if (container && current && container.scrollWidth > container.clientWidth) {
      container.scrollLeft += current.getBoundingClientRect().left - container.getBoundingClientRect().left;
    }
  }, [selectedKey]);
  return <nav aria-label="Setup steps" className="min-w-0">
    <ol ref={list} className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
      {steps.map((step, position) => {
        const gaps = step.areas.filter((area) => area.state === 'incomplete').length;
        const complete = step.areas.length > 0 && gaps === 0;
        return <li key={step.key} className="shrink-0 lg:shrink">
          <Link href={setupStepHref(organizationId, step.key)} aria-current={step.key === selectedKey ? 'step' : undefined}
            className={`${FOCUS_RING} flex items-center gap-2 rounded-md px-3 py-2.5 text-sm ${step.key === selectedKey ? 'bg-hover font-medium' : 'text-muted hover:bg-hover'}`}>
            {complete ? <CircleCheck aria-label="Done" className="size-4 shrink-0" /> : <span className="tabular-nums">{position + 1}.</span>}
            <span>{step.label}</span>
            {gaps ? <span className="ml-auto tabular-nums">{gaps}</span> : null}
          </Link>
        </li>;
      })}
    </ol>
  </nav>;
}
