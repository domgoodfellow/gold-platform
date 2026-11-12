import Link from 'next/link';
import { CardSection } from '@/components/surfaces/card';
import { CopyField } from '@/components/controls/copy-field';
import { Hint } from '@/components/controls/inputs';
import type { ManagedAddress as ManagedAddressState } from '@/lib/domain/domains/domains';

/**
 * The GildOps address a business's public name produces. There is nothing to connect or verify:
 * it exists the moment the business has a public name, on a deployment that offers one, and not
 * before — the platform never picks a name for it.
 */
export function ManagedAddress({ address, generalHref }: { address: ManagedAddressState; generalHref: string }) {
  return (
    <CardSection title="GildOps address">
      {address.state === 'ready' ? (
        <div className="mt-2 flex flex-col gap-2">
          <CopyField value={address.hostname} label="GildOps address" />
          <Hint>Opens your published website. It follows your public name in General settings.</Hint>
        </div>
      ) : address.state === 'no_slug' ? (
        <Hint className="mt-2">
          Set a public name on{' '}
          <Link href={generalHref} className="underline underline-offset-4">
            Settings → General
          </Link>{' '}
          to get your GildOps address.
        </Hint>
      ) : (
        <Hint className="mt-2">GildOps addresses aren’t available yet.</Hint>
      )}
    </CardSection>
  );
}
