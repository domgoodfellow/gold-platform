import type { ComponentProps, ReactNode } from 'react';
import { cx } from '../class-names';
import { ErrorText, FieldLabel, Hint } from './inputs';

export type FieldControlProps = {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
};

/**
 * One accessible field relationship: its visible label, optional help, control and error.
 * Validation remains in the domain/server action; this component only makes the result legible.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <FieldLabel htmlFor={id}>
        {label}
        {optional ? <span className="ml-1 font-normal text-subtle">(optional)</span> : null}
      </FieldLabel>
      {hint ? <Hint id={hintId}>{hint}</Hint> : null}
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      <ErrorText id={errorId}>{error}</ErrorText>
    </div>
  );
}

/** Actions wrap on narrow screens and keep their source order for keyboard users. */
export function FormActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cx('flex flex-wrap items-center gap-2', className)}
    />
  );
}

/** Form-level failure feedback; field-specific failures belong in `FormField`. */
export function FormError({ children, className, ...props }: ComponentProps<'p'>) {
  return (
    <ErrorText role="alert" aria-live="polite" {...props} className={className}>
      {children}
    </ErrorText>
  );
}
