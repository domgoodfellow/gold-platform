import type { Metadata } from 'next';

/** An embedded form is a fragment of someone else's page: no search listing, no background of its own. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function EmbedLayout({ children }: LayoutProps<'/embed'>) {
  return (
    <>
      <style>{'html,body{background:transparent !important}'}</style>
      {children}
    </>
  );
}
