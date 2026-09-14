import type { ComponentProps } from 'react';
import { Input } from '@gold/ui/components/input';
import { Label } from '@gold/ui/components/label';
import { NativeSelect } from '@gold/ui/components/native-select';
import { Textarea } from '@gold/ui/components/textarea';
import { cx, FOCUS_RING } from '../class-names';

/** Shadows the native `size` attribute (visible width in characters), unused here and repurposed. */
export type ControlSize = 'default' | 'small';

export function TextInput({
  size = 'default',
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'size'> & { size?: ControlSize }) {
  return <Input {...props} className={cx(FOCUS_RING, size === 'small' && 'h-7 px-2 text-sm', className)} />;
}

export function SelectInput({
  size = 'default',
  className,
  ...props
}: Omit<ComponentProps<'select'>, 'size'> & { size?: ControlSize }) {
  return <NativeSelect {...props} wrapperClassName={className} className={cx(FOCUS_RING, size === 'small' && 'h-7 px-2 pr-7 text-sm')} />;
}

export function TextArea({
  size = 'default',
  className,
  ...props
}: ComponentProps<'textarea'> & { size?: ControlSize }) {
  return <Textarea {...props} className={cx(FOCUS_RING, size === 'small' && 'min-h-16 px-2 py-1 text-sm', className)} />;
}

/** Names the input; `Hint` explains it. */
export function FieldLabel({ className, ...props }: ComponentProps<'label'>) {
  return <Label {...props} className={className} />;
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
