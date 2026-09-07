/**
 * Sign in and sign up, which are one screen with two verbs — the only route group here that
 * earns a layout, since both pages carried an identical centred `<main>` (D23). A route group is
 * a layout boundary, never a security boundary — `proxy.ts` decides what an anonymous caller may
 * open, by path, and groups don't change paths (I12).
 */
export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center p-8">{children}</main>;
}
