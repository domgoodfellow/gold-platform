import type { FormProjection } from '@gold/schemas';
import { BrandStyle } from '@/features/branding/brand-style';
import { PublicHeader } from '@/features/public-profile/public-header';
import { KeyedPublicForm } from './keyed-public-form';

/**
 * A form as a page of its own, in the business's own words and brand. The slug address, the stable
 * key address and a business's own hostname all render this; they differ only in how the form was
 * found.
 */
export function HostedFormPage({ form, logoUrl }: { form: FormProjection; logoUrl: string | null }) {
  return (
    <main data-brand className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <BrandStyle brand={form.brand} />
      <PublicHeader profile={form.profile} logoUrl={logoUrl} />
      <div className="mt-8">
        <KeyedPublicForm definition={form.definition} revisionId={form.revisionId} publicKey={form.publicKey} source="hosted" />
      </div>
    </main>
  );
}
