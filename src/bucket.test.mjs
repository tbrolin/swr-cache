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
  });

  test('revalidate updates content and timestamp', async () => {
    const bucket = new Bucket({ key: 'test' });
    const mockFetcher = jest.fn().mockResolvedValue('new content');
    
    await bucket.revalidate(mockFetcher);
    
    expect(bucket.content).toBe('new content');
    expect(bucket.revalidated).toBe(1000);
    expect(bucket.revalidating).toBe(false);
    expect(mockFetcher).toHaveBeenCalledWith('test');
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