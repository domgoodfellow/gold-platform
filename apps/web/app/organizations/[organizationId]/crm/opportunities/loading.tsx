import { LocationLoading } from '../../location-loading';

/** The bar and the page's heading keep this route's location while it loads (ADR-047). */
export default function Loading() {
  return <LocationLoading />;
}
