const LOCAL_SITE_URL = 'http://localhost:3000';

/**
 * The canonical address for GOLD's own public site.
 *
 * Never derive this from a request Host header: canonicals, sitemap entries, and social URLs are
 * declarations of the deployment's identity, not reflections of caller-controlled input.
 */
export function siteUrl(): URL {
  const configured =
    process.env.SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : LOCAL_SITE_URL);

  const url = new URL(configured);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('SITE_URL must use http or https.');
  }

  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

export function canonicalUrl(pathname: string): URL {
  return new URL(pathname, siteUrl());
}
