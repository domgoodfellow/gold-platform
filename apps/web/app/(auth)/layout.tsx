/**
 * Sign in and sign up, which are one screen with two verbs.
 *
 * **The only group here that earns a layout today.** `(marketing)` and `(public)` are grouping
 * decisions — they say which surface a route belongs to, which is what `constraints.md` D20
 * enumerates and what nothing in the tree used to record — but neither has chrome its routes
 * share yet, and a pass-through layout is code that does nothing. This one is different: both
 * pages carried an identical centred `<main>`, and the second copy of it is exactly the drift
 * D23 names when it says one component file extended, never a parallel set per surface.
 *
 * **A route group is a layout boundary and never a security boundary.** Nothing is protected by
 * living in `(auth)` or reachable by living outside it: `proxy.ts` decides what a caller with no
 * session may open, by path, and groups do not change paths. That is the same reasoning that
 * makes the operator shell not the authorization boundary either — a layout is no more a guard
 * than a redirect is (I12).
 */
export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center p-8">{children}</main>;
}
