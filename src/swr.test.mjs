import { jest } from '@jest/globals'
import SWR from './swr.mjs'

global.fetch = jest.fn()

describe('SWR', () => {
  let swr
  let mockFetch

  beforeEach(() => {
    jest.clearAllMocks()
    swr = new SWR()
    mockFetch = jest.fn()
    global.fetch = mockFetch
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    test('initializes with default values', () => {
      expect(swr.maxAge).toBe(60_000)
      expect(swr.staleWhileRevalidate).toBe(30_000)
      expect(swr.maxSize).toBe(10_000)
      expect(swr.onError).toBeNull()
      expect(swr.onRevalidate).toBeNull()
      expect(swr.buckets).toBeInstanceOf(Map)
    })

    test('accepts custom values', () => {
      const onError = jest.fn()
      const onRevalidate = jest.fn()
      const custom = new SWR({
        maxAge: 5_000,
        staleWhileRevalidate: 2_000,
        maxSize: 50,
        onError,
        onRevalidate,
      })
      expect(custom.maxAge).toBe(5_000)
      expect(custom.staleWhileRevalidate).toBe(2_000)
      expect(custom.maxSize).toBe(50)
      expect(custom.onError).toBe(onError)
      expect(custom.onRevalidate).toBe(onRevalidate)
    })
  })

  // ---------------------------------------------------------------------------
  // size getter
  // ---------------------------------------------------------------------------

  describe('size', () => {
    test('returns 0 on an empty cache', () => {
      expect(swr.size).toBe(0)
    })

    test('reflects number of cached entries', async () => {
      mockFetch.mockResolvedValue('data')
      await swr.get('key1')
      expect(swr.size).toBe(1)
      await swr.get('key2')
      expect(swr.size).toBe(2)
    })
  })

  // ---------------------------------------------------------------------------
  // has()
  // ---------------------------------------------------------------------------

  describe('has()', () => {
    test('returns false for unknown keys', () => {
      expect(swr.has('missing')).toBe(false)
    })

    test('returns true after a key has been fetched', async () => {
      mockFetch.mockResolvedValue('data')
      await swr.get('key1')
      expect(swr.has('key1')).toBe(true)
      expect(swr.has('key2')).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // delete()
  // ---------------------------------------------------------------------------

  describe('delete()', () => {
    test('removes a cached entry and returns true', async () => {
      mockFetch.mockResolvedValue('data')
      await swr.get('key1')
      expect(swr.has('key1')).toBe(true)

      const removed = swr.delete('key1')
      expect(removed).toBe(true)
      expect(swr.has('key1')).toBe(false)
      expect(swr.size).toBe(0)
    })

    test('returns false when the key does not exist', () => {
      expect(swr.delete('ghost')).toBe(false)
    })

    test('forces a fresh fetch after deletion', async () => {
      mockFetch
        .mockResolvedValueOnce('first')
        .mockResolvedValueOnce('second')

      await swr.get('key1')
      swr.delete('key1')
      const result = await swr.get('key1')

      expect(result).toBe('second')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  // ---------------------------------------------------------------------------
  // clear()
  // ---------------------------------------------------------------------------

  describe('clear()', () => {
    test('empties the cache', async () => {
      mockFetch.mockResolvedValue('data')
      await swr.get('key1')
      await swr.get('key2')
      expect(swr.size).toBe(2)

      swr.clear()
      expect(swr.size).toBe(0)
      expect(swr.has('key1')).toBe(false)
      expect(swr.has('key2')).toBe(false)
    })

    test('forces fresh fetches after clearing', async () => {
      mockFetch
        .mockResolvedValueOnce('first')
        .mockResolvedValueOnce('second')

      await swr.get('key1')
      swr.clear()
      const result = await swr.get('key1')

      expect(result).toBe('second')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  // ---------------------------------------------------------------------------
  // get() – fresh / stale / empty lifecycle
  // ---------------------------------------------------------------------------

  describe('get()', () => {
    test('returns fresh content without revalidation', async () => {
      const key = 'https://api.example.com/data'
      mockFetch.mockResolvedValue('fresh content')

      const result1 = await swr.get(key)
      expect(result1).toBe('fresh content')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const result2 = await swr.get(key)
      expect(result2).toBe('fresh content')
      expect(mockFetch).toHaveBeenCalledTimes(1) // no extra fetch
    })

    test('returns stale content and triggers background revalidation', async () => {
      const key = 'https://api.example.com/data'
      mockFetch
        .mockResolvedValueOnce('initial content')
        .mockResolvedValueOnce('updated content')

      swr = new SWR({ maxAge: 100, staleWhileRevalidate: 200 })

      const result1 = await swr.get(key)
      expect(result1).toBe('initial content')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Wait for content to become stale but not expired
      await new Promise(resolve => setTimeout(resolve, 150))

      const result2 = await swr.get(key)
      expect(result2).toBe('initial content') // still returns stale
      expect(mockFetch).toHaveBeenCalledTimes(2) // background fetch triggered

      // Wait for background revalidation to settle
      await new Promise(resolve => setTimeout(resolve, 50))

      const result3 = await swr.get(key)
      expect(result3).toBe('updated content')
      expect(mockFetch).toHaveBeenCalledTimes(2) // no additional fetch
    })

    test('awaits revalidation when content is empty (expired)', async () => {
      const key = 'https://api.example.com/data'
      mockFetch
        .mockResolvedValueOnce('initial content')
        .mockResolvedValueOnce('updated content')

      swr = new SWR({ maxAge: 10, staleWhileRevalidate: 10 })

      const result1 = await swr.get(key)
      expect(result1).toBe('initial content')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Wait for complete expiry
      await new Promise(resolve => setTimeout(resolve, 25))

      const result2 = await swr.get(key)
      expect(result2).toBe('updated content')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  // ---------------------------------------------------------------------------
  // Per-call overrides
  // ---------------------------------------------------------------------------

  describe('per-call maxAge / staleWhileRevalidate overrides', () => {
    test('per-call maxAge overrides instance default', async () => {
      // Instance default is 60 000 ms (very long), override to 50 ms
      swr = new SWR({ maxAge: 60_000, staleWhileRevalidate: 60_000 })
      mockFetch
        .mockResolvedValueOnce('first')
        .mockResolvedValueOnce('second')

      await swr.get('key', mockFetch, { maxAge: 50, staleWhileRevalidate: 50 })

      await new Promise(resolve => setTimeout(resolve, 110))

      const result = await swr.get('key', mockFetch, { maxAge: 50, staleWhileRevalidate: 50 })
      expect(result).toBe('second')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  // ---------------------------------------------------------------------------
  // LRU eviction / limitSize
  // ---------------------------------------------------------------------------

  describe('LRU eviction', () => {
    test('removes oldest entries when size exceeds maxSize', async () => {
      swr = new SWR({ maxSize: 2 })
      mockFetch.mockResolvedValue('content')

      await swr.get('key1')
      await swr.get('key2')
      await swr.get('key3')

      expect(swr.size).toBe(2)
      expect(swr.has('key1')).toBe(false)
      expect(swr.has('key2')).toBe(true)
      expect(swr.has('key3')).toBe(true)
    })

    test('respects LRU order on access', async () => {
      swr = new SWR({ maxSize: 3 })
      mockFetch.mockImplementation((key) => Promise.resolve(`content for ${key}`))

      await swr.get('key1')
      await swr.get('key2')
      await swr.get('key3')

      // Touch key1 so key2 becomes the LRU
      await swr.get('key1')

      // Adding key4 should evict key2
      await swr.get('key4')

      expect(swr.size).toBe(3)
      expect(swr.has('key1')).toBe(true)
      expect(swr.has('key2')).toBe(false)
      expect(swr.has('key3')).toBe(true)
      expect(swr.has('key4')).toBe(true)

      const keys = Array.from(swr.buckets.keys())
      expect(keys).toEqual(['key3', 'key1', 'key4'])

      expect(mockFetch).toHaveBeenCalledTimes(4)
    })
  })

  // ---------------------------------------------------------------------------
  // onError hook
  // ---------------------------------------------------------------------------

  describe('onError hook', () => {
    test('called when revalidator throws on empty bucket', async () => {
      const onError = jest.fn()
      swr = new SWR({ onError })
      const boom = new Error('network failure')
      mockFetch.mockRejectedValue(boom)

      const result = await swr.get('key1', mockFetch)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith('key1', boom)
      expect(result).toBeNull()
    })

    test('called when background revalidation throws on stale bucket', async () => {
      const onError = jest.fn()
      swr = new SWR({ maxAge: 50, staleWhileRevalidate: 200, onError })

      mockFetch
        .mockResolvedValueOnce('stale data')
        .mockRejectedValueOnce(new Error('revalidation failed'))

      await swr.get('key1', mockFetch)

      // Wait for content to become stale
      await new Promise(resolve => setTimeout(resolve, 75))

      const result = await swr.get('key1', mockFetch)
      expect(result).toBe('stale data') // still returns stale

      // Wait for background revalidation to fail
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0]).toBe('key1')
      expect(onError.mock.calls[0][1].message).toBe('revalidation failed')
    })

    test('does not throw when onError is not set', async () => {
      mockFetch.mockRejectedValue(new Error('network failure'))
      await expect(swr.get('key1', mockFetch)).resolves.toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // onRevalidate hook
  // ---------------------------------------------------------------------------

  describe('onRevalidate hook', () => {
    test('called after a successful blocking revalidation', async () => {
      const onRevalidate = jest.fn()
      swr = new SWR({ onRevalidate })
      mockFetch.mockResolvedValue('fresh data')

      await swr.get('key1', mockFetch)

      expect(onRevalidate).toHaveBeenCalledTimes(1)
      expect(onRevalidate).toHaveBeenCalledWith('key1', 'fresh data')
    })

    test('called after a successful background revalidation', async () => {
      const onRevalidate = jest.fn()
      swr = new SWR({ maxAge: 50, staleWhileRevalidate: 200, onRevalidate })

      mockFetch
        .mockResolvedValueOnce('initial')
        .mockResolvedValueOnce('refreshed')

      await swr.get('key1', mockFetch)
      expect(onRevalidate).toHaveBeenCalledTimes(1)

      await new Promise(resolve => setTimeout(resolve, 75))

      await swr.get('key1', mockFetch) // triggers background revalidation

      await new Promise(resolve => setTimeout(resolve, 50))

      expect(onRevalidate).toHaveBeenCalledTimes(2)
      expect(onRevalidate).toHaveBeenLastCalledWith('key1', 'refreshed')
    })
  })
})