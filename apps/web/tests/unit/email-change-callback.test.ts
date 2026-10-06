import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/auth/email-change/route';

const exchange = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/server', () => ({ getDb: async () => ({ auth: { exchangeCodeForSession: exchange } }) }));
beforeEach(() => exchange.mockReset());

describe('dual email confirmation callback', () => {
  it('returns to Account after the first confirmation without claiming completion', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/auth/email-change?message=Confirmation+link+accepted'));
    expect(response.headers.get('Location')).toBe('/settings/account');
    expect(exchange).not.toHaveBeenCalled();
  });
  it('exchanges the final auth code and ignores arbitrary next destinations', async () => {
    exchange.mockResolvedValue({ error: null });
    const response = await GET(new NextRequest('http://localhost:3000/auth/email-change?code=verified-code&next=https://evil.example'));
    expect(exchange).toHaveBeenCalledWith('verified-code');
    expect(response.headers.get('Location')).toBe('/settings/account?emailChange=confirmed');
  });
  it('shows a rejected code as a failure', async () => {
    exchange.mockResolvedValue({ error: { message: 'expired' } });
    const response = await GET(new NextRequest('http://localhost:3000/auth/email-change?code=expired'));
    expect(response.headers.get('Location')).toBe('/settings/account?emailChange=failed');
  });
  it('preserves an Auth rejection that arrives before a code is issued', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/auth/email-change?error=access_denied'));
    expect(response.headers.get('Location')).toBe('/settings/account?emailChange=failed');
  });
});
