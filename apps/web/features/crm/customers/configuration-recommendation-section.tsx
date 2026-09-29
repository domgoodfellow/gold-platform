import { Hint } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/containers/section';
import type { ConfigurationRecommendation, ConfigurationRecommendationEntry } from '@/lib/domain/customers/configuration-recommendation';

function EntryRow({ entry }: { entry: ConfigurationRecommendationEntry }) {
  return (
    <li className="text-sm">
      <span className="text-subtle">
        {entry.productLabel} / {entry.moduleLabel}
      </span>{' '}
      {entry.label}
    </li>
  );
}

/**
 * What the catalogue suggests for this customer, from what discovery has covered so far —
 * outcomes, in the catalogue's own words, never a provider or an implementation detail. Recomputed
 * on every view: this is a read, not a proposal anybody has committed to (a commercial proposal,
 * a later slice, is the thing that freezes one).
 */
export function ConfigurationRecommendationSection({
  recommendation,
}: {
  recommendation: ConfigurationRecommendation;
}) {
  const { recommended, optional, notNeeded } = recommendation;

  if (recommended.length === 0 && optional.length === 0 && notNeeded.length === 0) {
    return (
      <Section>
        <SectionHeading>Proposed configuration</SectionHeading>
        <Hint className="mt-1">Answer some of Discovery to see what this suggests.</Hint>
      </Section>
    );
  }

  return (
    <Section>
      <SectionHeading>Proposed configuration</SectionHeading>
      <Hint className="mt-1">Drawn from Discovery, recomputed on every visit — nothing here is provisioned.</Hint>

      <div className="mt-4 flex flex-col gap-6">
        {recommended.length > 0 ? (
          <div>
            <h3 className="text-sm font-medium">Recommended</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {recommended.map((entry) => (
                <EntryRow key={entry.featureKey} entry={entry} />
              ))}
            </ul>
          </div>
        ) : null}

        {optional.length > 0 ? (
          <div>
            <h3 className="text-sm font-medium">Optional</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {optional.map((entry) => (
                <EntryRow key={entry.featureKey} entry={entry} />
              ))}
            </ul>
          </div>
        ) : null}

        {notNeeded.length > 0 ? (
          <div>
            <h3 className="text-sm font-medium">Not needed</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {notNeeded.map((entry) => (
                <EntryRow key={entry.featureKey} entry={entry} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
