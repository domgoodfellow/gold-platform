import type { ComponentProps } from 'react';
import { cx, FOCUS_RING } from '../class-names';

/** Shadows the native `size` attribute (visible width in characters), unused here and repurposed. */
export type ControlSize = 'default' | 'small';

const CONTROL_BASE = cx(
  'rounded border border-border focus-visible:border-accent-text aria-invalid:border-danger',
  FOCUS_RING,
);

const CONTROL_SIZE: Record<ControlSize, string> = {
  default: 'px-3 py-2',
  small: 'px-2 py-1 text-sm',
};

function control(size: ControlSize, className: string | undefined): string {
  return cx(CONTROL_BASE, CONTROL_SIZE[size], className);
}

export function TextInput({
  size = 'default',
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'size'> & { size?: ControlSize }) {
  return <input {...props} className={control(size, className)} />;
}

export function SelectInput({
  size = 'default',
  className,
  ...props
}: Omit<ComponentProps<'select'>, 'size'> & { size?: ControlSize }) {
  return <select {...props} className={control(size, className)} />;
}

export function TextArea({
  size = 'default',
  className,
  ...props
}: ComponentProps<'textarea'> & { size?: ControlSize }) {
  return <textarea {...props} className={control(size, className)} />;
}

/** Names the input; `Hint` explains it. */
export function FieldLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label {...props} className={cx('text-sm font-medium', className)} />;
}

export function Hint({
  weight = 'muted',
  className,
  ...props
}: ComponentProps<'p'> & { weight?: 'muted' | 'subtle' }) {
  return (
    <p {...props} className={cx('text-sm', weight === 'muted' ? 'text-muted' : 'text-subtle', className)} />
  );
}

/** Renders nothing when there's nothing to say, so callers don't need their own ternary. */
export function ErrorText({
  children,
  className,
  ...props
}: ComponentProps<'p'>) {
  if (!children) return null;
  return (
    <p {...props} className={cx('text-sm text-danger', className)}>
      {children}
    </p>
  );
}
