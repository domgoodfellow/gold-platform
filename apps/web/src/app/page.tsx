import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center p-8">
      <h1 className="text-2xl font-semibold">GOLD</h1>
      <p className="mt-2 text-sm opacity-70">
        One engine. Many businesses. Configuration, not forks.
      </p>
      <Link href="/organizations" className="mt-6 w-fit underline underline-offset-4">
        Organizations
      </Link>
    </main>
  );
}
