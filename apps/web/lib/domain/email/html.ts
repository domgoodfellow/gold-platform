import sanitizeHtml from 'sanitize-html';

/**
 * Inbound HTML is hostile content from a stranger, shown inside an application a business signs
 * into. This is the one policy that decides what of it may reach a screen, and it is applied on the
 * server so the browser is only ever handed the result — the raw markup never leaves the domain layer.
 *
 * **Allowlist, not blocklist.** Structure and basic text formatting survive; everything that can run
 * or phone home does not. No script or style (their content is discarded, not escaped into view), no
 * event-handler or `style` or `class` attribute, no form controls, no embedded frames or objects, no
 * `javascript:`/`data:` URL anywhere — a link is `http`, `https` or `mailto` or it is plain text.
 * **No images at all**: a remote image is how a sender learns that, and when, the mail was opened, and
 * a business reading its mail has not agreed to tell them. Every link opens in a new context with no
 * opener and no referrer, so a clicked link cannot reach back into the application.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'i', 'li', 'ol', 'p', 'pre', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
    'thead', 'tr', 'u', 'ul',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // `script`, `style` and their kin are dropped with their text, which is sanitize-html's default
  // for non-text tags; named here so the policy reads in one place.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  transformTags: {
    a: (_tag, attribs) => ({
      tagName: 'a',
      attribs: { ...(attribs.href ? { href: attribs.href } : {}), target: '_blank', rel: 'noopener noreferrer nofollow' },
    }),
  },
};

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
