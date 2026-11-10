import { Badge } from '@/components/display/data';
import { AVAILABILITY, type Availability } from '@/lib/marketing/content';

/**
 * Whether a product can be had today, as the commercial catalogue records it
 * (`lib/marketing/content.ts`). Words, not a colour: the label reads the same without colour.
 */
export function AvailabilityLabel({ availability, className }: { availability: Availability; className?: string }) {
  return (
    <Badge tone={availability === 'available' ? 'success' : 'neutral'} className={className}>
      {AVAILABILITY[availability].label}
    </Badge>
  );
}
