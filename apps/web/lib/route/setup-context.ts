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
  // Setup's own pages and Administration (which runs the platform, not this business) offer no way back to Setup.
  if (!match || ['setup', 'administration'].some((root) => match[2] === root || match[2].startsWith(`${root}/`)) || !setupStepKey(step)) return null;
  return `/organizations/${match[1]}/setup?${new URLSearchParams({ step: step! })}`;
}

export const configurationOwnerPath = (href: string) => href.split(/[?#]/)[0];
