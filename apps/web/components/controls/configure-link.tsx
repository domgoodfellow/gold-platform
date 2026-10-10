import { Settings2 } from 'lucide-react';
import { ButtonLink } from './button';

/**
 * The one way a workspace Home points at its configuration. It is a destination — a Settings
 * route or the workspace's own configuration page — never a second editor, and it always reads
 * "Configure" so it is found in the same place with the same name in every workspace. The page
 * rail's Configure mode (`PageHeader configure`) is for workspaces whose configuration opens
 * in-place; those and this do not appear together.
 */
export function ConfigureLink({ href, label = 'Configure', title }: { href: string; label?: string; title?: string }) {
  return (
    <ButtonLink href={href} tone="secondary" title={title}>
      <Settings2 aria-hidden />
      {label}
    </ButtonLink>
  );
}
