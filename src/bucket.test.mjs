import { jest } from '@jest/globals'
import Bucket, { EMPTY, FRESH, STALE } from './bucket.mjs';

describe('Bucket', () => {
  let originalDateNow;

  beforeAll(() => {
    originalDateNow = Date.now;
    Date.now = jest.fn(() => 1000);
  });

  afterAll(() => {
    Date.now = originalDateNow;
  });

  test('constructor initializes with default values', () => {
    const bucket = new Bucket({ key: 'test' });
    expect(bucket.key).toBe('test');
    expect(bucket.content).toBeNull();
    expect(bucket.state).toBe(EMPTY);
    expect(bucket.revalidated).toBe(Number.NEGATIVE_INFINITY);
    expect(bucket.revalidating).toBe(false);
    expect(bucket.error).toBeNull();
  });

  test('constructor does not compute an unused timestamp', () => {
    // Ensures the dead `const now = Date.now()` line is gone — if it were
    // present, Date.now would have been called once during construction.
    Date.now.mockClear();
    new Bucket({ key: 'test' });
    expect(Date.now).not.toHaveBeenCalled();
  });

  test('revalidate updates content and timestamp', async () => {
    const bucket = new Bucket({ key: 'test' });
    const mockFetcher = jest.fn().mockResolvedValue('new content');

    await bucket.revalidate(mockFetcher);

    expect(bucket.content).toBe('new content');
    expect(bucket.revalidated).toBe(1000);
    expect(bucket.revalidating).toBe(false);
    expect(bucket.error).toBeNull();
    expect(mockFetcher).toHaveBeenCalledWith('test');
  });

  test('revalidate does nothing when already revalidating', async () => {
    const bucket = new Bucket({ key: 'test' });
    bucket.revalidating = true;
    const mockFetcher = jest.fn().mockResolvedValue('content');

    await bucket.revalidate(mockFetcher);

    expect(mockFetcher).not.toHaveBeenCalled();
    expect(bucket.content).toBeNull();
  });

  test('revalidate resets revalidating flag and stores error when revalidator throws', async () => {
    const bucket = new Bucket({ key: 'test' });
    const err = new Error('network failure');
    const mockFetcher = jest.fn().mockRejectedValue(err);

    await expect(bucket.revalidate(mockFetcher)).rejects.toThrow('network failure');

    // revalidating must be reset to false via finally
    expect(bucket.revalidating).toBe(false);
    // error must be stored on the bucket
    expect(bucket.error).toBe(err);
    // content must be unchanged
    expect(bucket.content).toBeNull();
    // revalidated timestamp must be unchanged
    expect(bucket.revalidated).toBe(Number.NEGATIVE_INFINITY);
  });

  test('revalidate clears previous error on success', async () => {
    const bucket = new Bucket({ key: 'test' });
    const err = new Error('first failure');
    const failFetcher = jest.fn().mockRejectedValue(err);
    const okFetcher = jest.fn().mockResolvedValue('recovered content');

    // First call fails
    await expect(bucket.revalidate(failFetcher)).rejects.toThrow();
    expect(bucket.error).toBe(err);

    // Second call succeeds — error should be cleared
    await bucket.revalidate(okFetcher);
    expect(bucket.error).toBeNull();
    expect(bucket.content).toBe('recovered content');
  });

  test('revalidate allows retry after failure (revalidating flag is reset)', async () => {
    const bucket = new Bucket({ key: 'test' });
    const mockFetcher = jest.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('success');

    await expect(bucket.revalidate(mockFetcher)).rejects.toThrow('fail');
    expect(bucket.revalidating).toBe(false);

    await bucket.revalidate(mockFetcher);
    expect(bucket.content).toBe('success');
    expect(mockFetcher).toHaveBeenCalledTimes(2);
  });

  test('update method sets correct state based on timestamps', () => {
    const bucket = new Bucket({ key: 'test' });
    bucket.revalidated = 500;

    bucket.update({ now: 1000, freshness: 600, staleness: 1000 });
    expect(bucket.state).toBe(FRESH);

    bucket.update({ now: 1200, freshness: 600, staleness: 1000 });
    expect(bucket.state).toBe(STALE);

    bucket.update({ now: 1600, freshness: 600, staleness: 1000 });
    expect(bucket.state).toBe(EMPTY);
    expect(bucket.content).toBeNull();
  });

  test('update to EMPTY does not leave a dangling property (no delete+reassign)', () => {
    const bucket = new Bucket({ key: 'test' });
    bucket.content = 'something';
    bucket.revalidated = 500;

    bucket.update({ now: 1600, freshness: 600, staleness: 1000 });

    // Property must exist (not deleted) and be null
    expect(Object.prototype.hasOwnProperty.call(bucket, 'content')).toBe(true);
    expect(bucket.content).toBeNull();
  });

  test('state getters return correct values', () => {
    const bucket = new Bucket({ key: 'test' });

    bucket.state = EMPTY;
    expect(bucket.isEmpty).toBe(true);
    expect(bucket.isFresh).toBe(false);
    expect(bucket.isStale).toBe(false);

    bucket.state = FRESH;
    expect(bucket.isEmpty).toBe(false);
    expect(bucket.isFresh).toBe(true);
    expect(bucket.isStale).toBe(false);

    bucket.state = STALE;
    expect(bucket.isEmpty).toBe(false);
    expect(bucket.isFresh).toBe(false);
    expect(bucket.isStale).toBe(true);
  });
});