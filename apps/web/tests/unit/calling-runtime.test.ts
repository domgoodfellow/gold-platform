import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callingRuntimeConfigured } from '@/lib/application/communications/calling-runtime';

const adapter = vi.hoisted(() => ({ provider: vi.fn(), callback: vi.fn() }));
vi.mock('@/lib/adapters/telephony', () => ({ telephonyProvider: adapter.provider, callbackBase: adapter.callback }));

beforeEach(() => {
  vi.clearAllMocks();
  adapter.callback.mockReturnValue('https://callbacks.example.test');
  adapter.provider.mockResolvedValue({});
});

describe('calling runtime readiness', () => {
  it('awaits the provider lookup instead of treating a promise as a configured provider', async () => {
    adapter.provider.mockResolvedValue(null);
    expect(await callingRuntimeConfigured(true)).toBe(false);
  });
  it('requires the provider and callback address', async () => {
    expect(await callingRuntimeConfigured(true)).toBe(true);
    adapter.callback.mockReturnValue(null);
    adapter.provider.mockClear();
    expect(await callingRuntimeConfigured(true)).toBe(false);
    expect(adapter.provider).not.toHaveBeenCalled();
  });
  it('does not inspect infrastructure without calling permission', async () => {
    expect(await callingRuntimeConfigured(false)).toBe(false);
    expect(adapter.callback).not.toHaveBeenCalled();
    expect(adapter.provider).not.toHaveBeenCalled();
  });
});
