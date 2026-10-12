import type { ReactNode } from 'react';
import { VisualScope } from '@gold/ui/components/visual-scope';
import { Toaster } from '@gold/ui/components/sonner';
import { getAppearance } from '@/lib/domain/identity/appearance';
import { getDb } from '@/lib/db/server';
import type { Brand } from '@/lib/domain/branding/brand';
import { BrandStyle } from '@/features/branding/brand-style';

/** Server-owned selection, read under this account's JWT. No draft or browser persistence. */
export async function AccountAppearance({ children, brand }: { children: ReactNode; brand?: Brand }) {
  const selection = await getAppearance(await getDb());
  return <VisualScope selection={selection} data-account-appearance data-brand={brand ? '' : undefined} className="min-h-full">
    {brand && <BrandStyle brand={brand} />}
    {children}<Toaster />
  </VisualScope>;
}
