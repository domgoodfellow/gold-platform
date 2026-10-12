import { notFound } from 'next/navigation';
import { DesignGallery } from '@/features/appearance/design-gallery';

export default function DesignSystemPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <DesignGallery />;
}
