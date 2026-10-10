import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/public', () => ({ getPublicDb: vi.fn() }));
import { normalizeRequestHost } from '@/lib/domain/domains/resolve';
import { isDeploymentHost } from '@/lib/route/hostname';

/**
 * Which names the platform will try to resolve to a business. A request's Host is attacker
 * controlled, so only a plain DNS-shaped name is ever looked up, and the deployment's own
 * addresses are never treated as a tenant's.
 */
describe('request host handling', () => {
  it('normalises case, port and a trailing dot to one comparable name', () => {
    expect(normalizeRequestHost('Shop.Example.COM:3000')).toBe('shop.example.com');
    expect(normalizeRequestHost('shop.example.com.')).toBe('shop.example.com');
  });

  it('refuses anything that is not a plain hostname, instead of passing it on', () => {
    for (const bad of [null, undefined, '', ' ', 'exa mple.com', 'shop.example.com/evil', 'a@b.com', 'shop.example.com\r\nX: y', '👍.example.com', 'x'.repeat(260)]) {
      expect(normalizeRequestHost(bad as string | null), String(bad)).toBeNull();
    }
  });

  it('never treats the deployment\'s own hosts as a business', () => {
    for (const own of ['localhost', '127.0.0.1', '0.0.0.0']) expect(isDeploymentHost(own)).toBe(true);
    expect(isDeploymentHost('someone-elses-shop.example.com')).toBe(false);
  });
});
