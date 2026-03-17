import Bucket from './bucket.mjs'

/**
 * @typedef {Object} SWROptions
 * @property {number} [maxAge=60_000]
 *   How long, in milliseconds, a cached value is considered **fresh**.
 *   During this window every `get()` call returns the cached value
 *   immediately without contacting the revalidator.
 * @property {number} [staleWhileRevalidate=30_000]
 *   Extra time, in milliseconds, **after** `maxAge` during which the
 *   cached value is considered **stale but usable**.  A `get()` call
 *   in this window returns the old value immediately while silently
 *   triggering a background revalidation so the next caller gets fresh
 *   data.  Once both windows have elapsed the entry is **empty** and
 *   the next `get()` call blocks until the revalidator resolves.
 * @property {number} [maxSize=10_000]
 *   Maximum number of entries the cache may hold at once.  When the
 *   limit is exceeded the least-recently-used entry is evicted
 *   (LRU strategy).
 * @property {((key: string, error: Error) => void) | null} [onError=null]
 *   Optional callback invoked whenever a revalidator throws or rejects.
 *   Receives the cache key and the error.  When omitted, errors are
 *   silently swallowed so background revalidations never crash the
 *   process.
 * @property {((key: string, content: *) => void) | null} [onRevalidate=null]
 *   Optional callback invoked after every successful revalidation,
 *   whether blocking (empty bucket) or background (stale bucket).
 *   Receives the cache key and the freshly fetched content.
 */

/**
 * @typedef {Object} GetOptions
 * @property {number} [maxAge]
 *   Per-call override for {@link SWROptions.maxAge}.
 * @property {number} [staleWhileRevalidate]
 *   Per-call override for {@link SWROptions.staleWhileRevalidate}.
 */

/**
 * @typedef {function(string): Promise<*>} Revalidator
 * A function that accepts a cache key and returns a Promise that
 * resolves to the fresh value for that key.  Defaults to the global
 * `fetch`, making URL strings a natural choice for keys.
 */

/**
 * An in-memory Stale-While-Revalidate (SWR) cache.
 *
 * ### How it works
 *
 * Each cache entry goes through three states:
 *
 * ```
 * ──────────────────────────────────────────────────────────────►  time
 *   fetch   │◄──── maxAge ────►│◄── staleWhileRevalidate ──►│
 *           │                  │                             │
 *         EMPTY  ──►  FRESH  ──►  STALE  ──────────────────►  EMPTY
 * ```
 *
 * - **FRESH** – returned immediately; no network call made.
 * - **STALE** – returned immediately; background revalidation is fired.
 * - **EMPTY** – caller waits while a blocking revalidation runs.
 *
 * Entries are managed with an LRU policy: the least-recently-used
 * entry is evicted whenever `maxSize` is exceeded.
 *
 * ### Basic usage
 *
 * ```js
 * import SWR from './swr.mjs'
 *
 * const cache = new SWR({ maxAge: 5_000, staleWhileRevalidate: 10_000 })
 *
 * const data = await cache.get('https://api.example.com/users')
 * ```
 *
 * ### Custom revalidator
 *
 * ```js
 * import SWR from './swr.mjs'
 * import db from './db.mjs'
 *
 * const cache = new SWR({ maxAge: 30_000 })
 *
 * const user = await cache.get(
 *   `user:${id}`,
 *   (key) => db.users.findById(key.split(':')[1])
 * )
 * ```
 */
export default class SWR {
  /**
   * Creates a new SWR cache instance.
   *
   * @param {SWROptions} [options={}]
   *
   * @example
   * // All defaults
   * const cache = new SWR()
   *
   * @example
   * // Custom timing and error reporting
   * const cache = new SWR({
   *   maxAge: 10_000,
   *   staleWhileRevalidate: 5_000,
   *   maxSize: 500,
   *   onError: (key, err) => console.error(`Cache error for ${key}:`, err),
   *   onRevalidate: (key, value) => console.log(`Refreshed ${key}`),
   * })
   */
  constructor ({
    maxAge = 60_000,
    staleWhileRevalidate = 30_000,
    maxSize = 10_000,
    onError = null,
    onRevalidate = null,
  } = {}) {
    this.buckets = new Map()
    /** @type {number} How long in ms a cached value stays fresh. */
    this.maxAge = maxAge
    /** @type {number} Extra ms after maxAge during which stale values are still served. */
    this.staleWhileRevalidate = staleWhileRevalidate
    /** @type {number} Maximum number of entries before LRU eviction kicks in. */
    this.maxSize = maxSize
    /** @type {((key: string, error: Error) => void) | null} */
    this.onError = onError
    /** @type {((key: string, content: *) => void) | null} */
    this.onRevalidate = onRevalidate
  }

  /**
   * The number of entries currently held in the cache.
   *
   * @type {number}
   *
   * @example
   * console.log(cache.size) // 0
   * await cache.get('key1', revalidator)
   * console.log(cache.size) // 1
   */
  get size () {
    return this.buckets.size
  }

  /**
   * Returns `true` if the cache currently holds an entry for `key`,
   * regardless of whether that entry is fresh, stale, or empty.
   *
   * Unlike `get()`, this method does **not** trigger revalidation.
   *
   * @param {string} key
   * @returns {boolean}
   *
   * @example
   * await cache.get('user:1', fetchUser)
   * cache.has('user:1') // true
   * cache.has('user:2') // false
   */
  has (key) {
    return this.buckets.has(key)
  }

  /**
   * Removes a single entry from the cache.
   *
   * Useful for manual invalidation after a mutation (e.g. a POST or
   * PUT request), so the next `get()` call fetches fresh data.
   *
   * @param {string} key
   * @returns {boolean} `true` if an entry existed and was removed,
   *   `false` if the key was not in the cache.
   *
   * @example
   * await api.updateUser(id, payload)
   * cache.delete(`user:${id}`) // force next read to fetch fresh data
   */
  delete (key) {
    return this.buckets.delete(key)
  }

  /**
   * Removes **all** entries from the cache.
   *
   * Every subsequent `get()` call will block on a fresh revalidation
   * until the cache is populated again.
   *
   * @returns {void}
   *
   * @example
   * // Invalidate everything after a user logs out
   * cache.clear()
   */
  clear () {
    this.buckets.clear()
  }

  /**
   * Promotes `key` to the most-recently-used position in the LRU map.
   *
   * JavaScript's `Map` preserves insertion order, so deletion followed
   * by re-insertion moves the entry to the end (most-recent position).
   *
   * @param {string} key
   */
  #useKey (key) {
    if (this.buckets.has(key)) {
      const bucket = this.buckets.get(key)
      this.buckets.delete(key)
      this.buckets.set(key, bucket)
    }
  }

  /**
   * Evicts the least-recently-used entries until the cache is within
   * `maxSize`.  The LRU entry is always the first key in the `Map`.
   */
  #limitSize () {
    while (this.buckets.size > this.maxSize) {
      const key = this.buckets.keys().next().value
      this.buckets.delete(key)
    }
  }

  /**
   * Runs `bucket.revalidate(revalidator)` and dispatches the result
   * to the `onRevalidate` / `onError` hooks.  Errors are caught here
   * so neither blocking nor background revalidations ever propagate
   * an unhandled rejection to the caller.
   *
   * @param {Bucket} bucket
   * @param {Revalidator} revalidator
   * @returns {Promise<void>}
   */
  async #revalidate (bucket, revalidator) {
    try {
      await bucket.revalidate(revalidator)
      if (this.onRevalidate) {
        this.onRevalidate(bucket.key, bucket.content)
      }
    } catch (error) {
      if (this.onError) {
        this.onError(bucket.key, error)
      }
    }
  }

  /**
   * Returns the cached value for `key`, fetching it via `revalidator`
   * if necessary.
   *
   * #### Resolution order
   *
   * 1. **Fresh** – returns the cached value immediately.
   * 2. **Stale** – returns the cached value immediately and fires a
   *    background revalidation so the *next* caller gets fresh data.
   * 3. **Empty / expired** – awaits the revalidator and returns the
   *    newly fetched value.
   *
   * #### Per-call timing overrides
   *
   * `maxAge` and `staleWhileRevalidate` can be overridden for a single
   * call via the third argument.  This is useful when different keys
   * have naturally different lifetimes but you want to share one cache
   * instance.
   *
   * @param {string} key
   *   Cache key.  When using the default `fetch` revalidator this
   *   should be a URL string.
   * @param {Revalidator} [revalidator=fetch]
   *   Async function called with `key` that returns the fresh value.
   * @param {GetOptions} [options={}]
   *   Per-call timing overrides.
   * @returns {Promise<*>} The cached or freshly fetched value.
   *
   * @example <caption>Default fetch revalidator (URL as key)</caption>
   * const data = await cache.get('https://api.example.com/posts')
   *
   * @example <caption>Custom async revalidator</caption>
   * const post = await cache.get(
   *   `post:${id}`,
   *   (key) => db.posts.find(key.split(':')[1])
   * )
   *
   * @example <caption>Per-call timing overrides</caption>
   * // This specific key stays fresh for only 2 seconds
   * const price = await cache.get('ticker:BTC', fetchPrice, {
   *   maxAge: 2_000,
   *   staleWhileRevalidate: 1_000,
   * })
   */
  async get (key, revalidator = fetch, {
    maxAge,
    staleWhileRevalidate,
  } = {}) {
    const freshness = maxAge ?? this.maxAge
    const staleness = freshness + (staleWhileRevalidate ?? this.staleWhileRevalidate)

    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = new Bucket({ key })
      this.buckets.set(key, bucket)
      this.#limitSize()
      // If the new bucket was evicted immediately due to maxSize, we still
      // service the request but the result won't be cached.
    } else {
      this.#useKey(key)
    }

    bucket.update({
      now: Date.now(),
      freshness,
      staleness,
    })

    if (bucket.isFresh) {
      return bucket.content
    }
    if (bucket.isStale) {
      // Fire-and-forget background revalidation, errors routed to onError
      this.#revalidate(bucket, revalidator)
      return bucket.content
    }
    if (bucket.isEmpty) {
      await this.#revalidate(bucket, revalidator)
      return bucket.content
    }

    throw new Error(`Unexpected bucket state: ${bucket.state}`)
  }
}