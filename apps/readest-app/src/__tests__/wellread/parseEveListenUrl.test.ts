import { describe, expect, it } from 'vitest';
import { parseEveListenUrl } from '@/services/wellread/eveListen';

describe('parseEveListenUrl', () => {
  it('extracts loopback URL from Nitro listen line', () => {
    expect(parseEveListenUrl('Listening http://127.0.0.1:54321/')).toBe('http://127.0.0.1:54321/');
  });

  it('normalizes 0.0.0.0 wildcard host to 127.0.0.1', () => {
    expect(parseEveListenUrl('Listening on http://0.0.0.0:4123')).toBe('http://127.0.0.1:4123/');
  });

  it('returns undefined when no URL is present', () => {
    expect(parseEveListenUrl('starting…')).toBeUndefined();
  });
});
