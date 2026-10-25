import { notFound } from 'next/navigation';
import { ChartGallery } from './chart-gallery';

/** Development-only gallery of the shared charts over synthetic fixtures, for visual review in each theme and width. */
export default function ChartsPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <ChartGallery />;
}
