import { redirect } from 'next/navigation';

/** There is no redundant overview: Organizations is the useful first control-plane task. */
export default function PlatformPage() {
  redirect('/platform/organizations');
}
