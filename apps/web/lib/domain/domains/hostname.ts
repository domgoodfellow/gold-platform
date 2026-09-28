/**
 * What counts as a hostname a business can connect, stated once for the dialog and the command.
 *
 * The database says it again (`begin_custom_domain_connection`, and the table's own check), and
 * is the authority; this exists so a person hears a sentence before a round trip, and so a pasted
 * `https://Shop.Example.com/` becomes the name it obviously means.
 */

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Lowercase, trimmed, no scheme, path, port or trailing dot. Never validates — see `checkHostname`. */
export function normalizeHostname(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split(/[/?#]/, 1)[0] ?? '';
  value = value.replace(/:\d+$/, '');
  return value.replace(/\.+$/, '');
}

export type HostnameProblem = 'empty' | 'shape' | 'single_label' | 'platform_zone';

export type HostnameCheck = { ok: true; hostname: string } | { ok: false; problem: HostnameProblem };

/**
 * `platformZone` is GildOps' own managed zone, when this deployment has one: its addresses come
 * from a business's public name, never from this form.
 */
export function checkHostname(input: string, platformZone?: string | null): HostnameCheck {
  const hostname = normalizeHostname(input);
  if (!hostname) return { ok: false, problem: 'empty' };

  const labels = hostname.split('.');
  if (labels.length < 2) return { ok: false, problem: 'single_label' };
  if (hostname.length > 253 || !labels.every((label) => LABEL.test(label))) return { ok: false, problem: 'shape' };
  if (platformZone && (hostname === platformZone || hostname.endsWith(`.${platformZone}`))) {
    return { ok: false, problem: 'platform_zone' };
  }
  return { ok: true, hostname };
}

export const HOSTNAME_PROBLEM: Record<HostnameProblem, string> = {
  empty: 'Enter the domain you want to connect.',
  shape: 'That is not a domain name. Use letters, numbers and hyphens, separated by dots.',
  single_label: 'Include the whole domain, such as www.example.com.',
  platform_zone: 'That address belongs to GildOps. Your GildOps address comes from your public name in General settings.',
};
