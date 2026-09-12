import { PageHeading } from '@/components/containers/section';

/** Neutral application state: never place GOLD's brand on a tenant's customer-facing surface. */
export default function PublicNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center p-6 sm:p-8">
      <p className="font-mono text-sm text-subtle">404</p>
      <PageHeading className="mt-2">This page is not available.</PageHeading>
      <p className="mt-3 text-sm text-muted">Check the address and try again.</p>
    </main>
  );
}
