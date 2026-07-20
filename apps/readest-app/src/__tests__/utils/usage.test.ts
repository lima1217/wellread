import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRpc = vi.fn();
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({ rpc: mockRpc }),
}));

import { QUOTA_TYPES, UsageStatsManager } from '@/utils/usage';

describe('QUOTA_TYPES', () => {
  test('has DAILY constant', () => {
    expect(QUOTA_TYPES.DAILY).toBe('daily');
  });

  test('has MONTHLY constant', () => {
    expect(QUOTA_TYPES.MONTHLY).toBe('monthly');
  });

  test('has YEARLY constant', () => {
    expect(QUOTA_TYPES.YEARLY).toBe('yearly');
  });
});

describe('UsageStatsManager', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('trackUsage', () => {
    test('returns data from rpc on success', async () => {
      mockRpc.mockResolvedValue({ data: 42, error: null });

      const result = await UsageStatsManager.trackUsage('user-1', 'some_usage', 10, {
        source: 'test',
      });

      expect(result).toBe(42);
      expect(mockRpc).toHaveBeenCalledWith('increment_daily_usage', {
        p_user_id: 'user-1',
        p_usage_type: 'some_usage',
        p_usage_date: new Date().toISOString().split('T')[0],
        p_increment: 10,
        p_metadata: { source: 'test' },
      });
    });

    test('uses default increment of 1 and empty metadata', async () => {
      mockRpc.mockResolvedValue({ data: 1, error: null });

      await UsageStatsManager.trackUsage('user-1', 'some_usage');

      expect(mockRpc).toHaveBeenCalledWith('increment_daily_usage', {
        p_user_id: 'user-1',
        p_usage_type: 'some_usage',
        p_usage_date: new Date().toISOString().split('T')[0],
        p_increment: 1,
        p_metadata: {},
      });
    });

    test('returns 0 when rpc returns an error', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'db error' } });

      const result = await UsageStatsManager.trackUsage('user-1', 'some_usage');

      expect(result).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Usage tracking error:', {
        message: 'db error',
      });
    });

    test('returns 0 when rpc throws an exception', async () => {
      mockRpc.mockRejectedValue(new Error('network failure'));

      const result = await UsageStatsManager.trackUsage('user-1', 'some_usage');

      expect(result).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Usage tracking failed:', expect.any(Error));
    });

    test('returns 0 when data is null', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      const result = await UsageStatsManager.trackUsage('user-1', 'some_usage');

      expect(result).toBe(0);
    });
  });

  describe('getCurrentUsage', () => {
    test('returns data from rpc on success', async () => {
      mockRpc.mockResolvedValue({ data: 100, error: null });

      const result = await UsageStatsManager.getCurrentUsage('user-1', 'some_usage', 'monthly');

      expect(result).toBe(100);
      expect(mockRpc).toHaveBeenCalledWith('get_current_usage', {
        p_user_id: 'user-1',
        p_usage_type: 'some_usage',
        p_period: 'monthly',
      });
    });

    test('uses default period of daily', async () => {
      mockRpc.mockResolvedValue({ data: 5, error: null });

      await UsageStatsManager.getCurrentUsage('user-1', 'some_usage');

      expect(mockRpc).toHaveBeenCalledWith('get_current_usage', {
        p_user_id: 'user-1',
        p_usage_type: 'some_usage',
        p_period: 'daily',
      });
    });

    test('returns 0 when rpc returns an error', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'db error' } });

      const result = await UsageStatsManager.getCurrentUsage('user-1', 'some_usage');

      expect(result).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Get current usage error:', {
        message: 'db error',
      });
    });

    test('returns 0 when rpc throws an exception', async () => {
      mockRpc.mockRejectedValue(new Error('network failure'));

      const result = await UsageStatsManager.getCurrentUsage('user-1', 'some_usage');

      expect(result).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Get current usage failed:', expect.any(Error));
    });

    test('returns 0 when data is null', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      const result = await UsageStatsManager.getCurrentUsage('user-1', 'some_usage');

      expect(result).toBe(0);
    });
  });
});
