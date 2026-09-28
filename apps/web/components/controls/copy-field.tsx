'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { cx } from '../class-names';
import { Button } from './button';
import { TextInput } from './inputs';

/**
 * A read-only value with a Copy button beside it — an invitation link, a DNS record. Extracted at
 * its second caller (the invitation form and the domain DNS table), so the two copy the same way
 * and say the same thing when they have.
 */
export function CopyField({
  value,
  label,
  copiedMessage = 'Copied',
  size = 'default',
  mono = false,
  className,
}: {
  value: string;
  /** The field's accessible name; the button is named from it. */
  label: string;
  copiedMessage?: string;
  size?: 'default' | 'small';
  /** For machine values a person must reproduce exactly (a DNS record). */
  mono?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className={cx('flex min-w-0 gap-2', className)}>
      <TextInput
        readOnly
        value={value}
        size={size}
        className={cx('min-w-0 flex-1', mono && 'font-mono text-xs')}
        aria-label={label}
      />
      <Button
        type="button"
        tone="secondary"
        size={size}
        aria-label={`Copy ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(copiedMessage);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
