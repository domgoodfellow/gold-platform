import type { ComponentProps } from 'react';
import { cx } from '../class-names';

/**
 * The form controls, and the three pieces of text that sit around them.
 *
 * `docs/ui-spec.md` §4: 244 `<input>`, 33 `<select>` and 36 `<label>` elements were served by no
 * shared control at all, and `INPUT_CLASS` had been declared as a local constant in eleven
 * separate files in four spellings that already disagreed. That is the failure D23's last bullet
 * names, arriving one file at a time rather than one surface at a time.
 *
 * Colour comes from the roles in `globals.css` and never from a literal. `ErrorText` is the
 * clearest reason that matters: the screens spelled the same refusal as `red-600` in 34 places
 * and `red-700` in 7, which nobody chose.
 *
 * **`size` shadows a real HTML attribute on `input` and `select` -- the visible width in
 * characters** -- so each control below omits the native one. Typescript caught this as
 * `Type '"default"' is not assignable to type 'never'`, which is what an intersection of two
 * incompatible `size` props collapses to. Nothing in the application used the native attribute.
 */
export type ControlSize = 'default' | 'small';

/**
 * The ring is part of the control, and it used not to be.
 *
 * `create-business-form.tsx` spelled four controls out by hand for exactly this — §4 recorded it
 * as "a real gap" and named this file as where it belonged. A focus style that lives at one call
 * site is a focus style the other ninety do not have, and keyboard focus being visible is not a
 * flourish: it is the only way somebody not using a mouse knows where they are.
 *
 * `focus-visible` rather than `focus`, so a mouse click does not leave a ring behind on a field
 * somebody is simply typing into — which is what made authors remove these in the first place.
 *
 * **The ring is `--accent-text`, not `--accent`, and the first version had that backwards.** The
 * two differ precisely when a tenant's colour is too close to the page to read against it — and
 * a focus ring is the one thing on screen whose entire job is to be seen. Painting it in the
 * unguaranteed value put the weakest colour in the place that most needed the guarantee that
 * `palette.ts` exists to give. Full opacity for the same reason: a ring at 30% of a colour
 * measured to reach 4.5:1 does not reach 4.5:1.
 */
const CONTROL_BASE =
  'rounded border border-border focus-visible:border-accent-text focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-accent-text';

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

/** What a control is called. Distinct from `Hint`: this names the input, that explains it. */
export function FieldLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label {...props} className={cx('text-sm font-medium', className)} />;
}

/**
 * Help text, and the quieter weight beneath it.
 *
 * `weight="subtle"` is the second level the screens were already drawing by hand as
 * `opacity-60` against `opacity-70`. Both are roles now; see `globals.css`.
 */
export function Hint({
  weight = 'muted',
  className,
  ...props
}: ComponentProps<'p'> & { weight?: 'muted' | 'subtle' }) {
  return (
    <p {...props} className={cx('text-sm', weight === 'muted' ? 'text-muted' : 'text-subtle', className)} />
  );
}

/**
 * A refusal, rendered where the person caused it.
 *
 * **Renders nothing when there is nothing to say**, which is why the call sites lost their
 * `{state.error ? … : null}` ternaries rather than keeping them around a component. A `''` and a
 * `null` are the same absence to a reader and were not always spelled the same way in the code.
 */
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
