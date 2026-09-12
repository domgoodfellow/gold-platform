import type { Metadata } from 'next';

/** Booking, confirmations, and token portals are transactional tenant surfaces, not search pages. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
};

export default function PublicTransactionLayout({ children }: LayoutProps<'/'>) {
  return children;
}
