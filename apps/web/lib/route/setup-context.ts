/** A bounded navigation hint, never setup state or an arbitrary return URL. */
export function setupStepKey(value: string | null | undefined): string | null {
  return value && /^[a-z][a-z-]{0,39}$/.test(value) ? value : null;
}

export function withSetupContext(href: string, step: string): string {
  if (!href.startsWith('/organizations/') || !setupStepKey(step)) return href;
  const url = new URL(href, 'http://local.invalid');
  url.searchParams.set('setupStep', step);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function setupReturnHref(pathname: string, step: string | null): string | null {
  const match = /^\/organizations\/([^/]+)\/(.+)$/.exec(pathname);
  if (!match || match[2] === 'setup' || match[2].startsWith('setup/') || !setupStepKey(step)) return null;
  return `/organizations/${match[1]}/setup?${new URLSearchParams({ step: step! })}`;
}

export const configurationOwnerPath = (href: string) => href.split(/[?#]/)[0];
