import { jest } from '@jest/globals'
import SWR from './swr.mjs';

// Mock the fetch function
global.fetch = jest.fn();

describe('SWR', () => {
  let swr;
  let mockFetch;

  beforeEach(() => {
    jest.clearAllMocks();
    swr = new SWR();
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  test('constructor initializes with default values', () => {
    expect(swr.freshness).toBe(60);
    expect(swr.staleness).toBe(90);
    expect(swr.maxSize).toBe(10000);
    expect(swr.buckets).toBeInstanceOf(Map);
  });

  test('get returns fresh content without revalidation', async () => {
    const key = 'https://api.example.com/data';
    mockFetch.mockResolvedValueOnce('fresh content');

    const result1 = await swr.get(key);
    expect(result1).toBe('fresh content');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const result2 = await swr.get(key);
    expect(result2).toBe('fresh content');
    expect(mockFetch).toHaveBeenCalledTimes(1); // Should not be called again
  });

  test('get returns stale content and triggers revalidation', async () => {
    const key = 'https://api.example.com/data';
    mockFetch
      .mockResolvedValueOnce('initial content')
      .mockResolvedValueOnce('updated content');

    // Set up SWR with short freshness and staleness periods for testing
    swr = new SWR({ maxAge: 100, staleWhileRevalidate: 200 });

    const result1 = await swr.get(key);
    expect(result1).toBe('initial content');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Wait for content to become stale
    await new Promise(resolve => setTimeout(resolve, 150));

    const result2 = await swr.get(key);
    expect(result2).toBe('initial content'); // Still returns stale content
    expect(mockFetch).toHaveBeenCalledTimes(2); // But triggers revalidation

    // Wait for revalidation to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    const result3 = await swr.get(key);
    expect(result3).toBe('updated content');
    expect(mockFetch).toHaveBeenCalledTimes(2); // No additional fetch
  });

  test('get revalidates expired content', async () => {
    const key = 'https://api.example.com/data';
    mockFetch
      .mockResolvedValueOnce('initial content')
      .mockResolvedValueOnce('updated content');

    // Set up SWR with very short freshness and staleness periods for testing
    swr = new SWR({ maxAge: 10, staleWhileRevalidate: 10 });

    const result1 = await swr.get(key);
    expect(result1).toBe('initial content');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Wait for content to expire completely
    await new Promise(resolve => setTimeout(resolve, 25));

    const result2 = await swr.get(key);
    expect(result2).toBe('updated content');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('limitSize removes oldest entries when size exceeds maxSize', async () => {
    swr = new SWR({ maxSize: 2 });
    mockFetch.mockResolvedValue('content');

    await swr.get('key1');
    await swr.get('key2');
    await swr.get('key3');

    expect(swr.buckets.size).toBe(2);
    expect(swr.buckets.has('key1')).toBe(false);
    expect(swr.buckets.has('key2')).toBe(true);
    expect(swr.buckets.has('key3')).toBe(true);
  });

  test('cache uses Least Recently Used (LRU) strategy', async () => {
    const swr = new SWR({ maxSize: 3 });
    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Mock fetch to return different values for different keys
    mockFetch.mockImplementation((key) => Promise.resolve(`content for ${key}`));

    // Fill the cache
    await swr.get('key1');
    await swr.get('key2');
    await swr.get('key3');

    expect(swr.buckets.size).toBe(3);
    expect(swr.buckets.has('key1')).toBe(true);
    expect(swr.buckets.has('key2')).toBe(true);
    expect(swr.buckets.has('key3')).toBe(true);

    // Access key1 to make it the most recently used
    await swr.get('key1');

    // Add a new key, which should evict the least recently used (key2)
    await swr.get('key4');

    expect(swr.buckets.size).toBe(3);
    expect(swr.buckets.has('key1')).toBe(true);
    expect(swr.buckets.has('key2')).toBe(false);
    expect(swr.buckets.has('key3')).toBe(true);
    expect(swr.buckets.has('key4')).toBe(true);

    // Verify the order of keys (least recent to most recent)
    const keys = Array.from(swr.buckets.keys());
    expect(keys).toEqual(['key3', 'key1', 'key4']);

    // Ensure fetch was called the correct number of times
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
