/**
 * Possible states for a cache entry.
 *
 * - `"empty"`  — No content available; the next `get()` will block until fresh
 *                data is fetched.
 * - `"fresh"`  — Content is within its `maxAge` window; returned immediately.
 * - `"stale"`  — Content has exceeded `maxAge` but is within the
 *                `staleWhileRevalidate` window; returned immediately while a
 *                background revalidation runs in parallel.
 */
export type BucketState = 'empty' | 'fresh' | 'stale'

/** Literal constant for the `"empty"` bucket state. */
export declare const EMPTY: 'empty'

/** Literal constant for the `"fresh"` bucket state. */
export declare const FRESH: 'fresh'

/** Literal constant for the `"stale"` bucket state. */
export declare const STALE: 'stale'

// ---------------------------------------------------------------------------
// Revalidator
// ---------------------------------------------------------------------------

/**
 * An async function that accepts a cache key and returns a Promise resolving
 * to the fresh value for that key.
 *
 * The default revalidator is the global `fetch`, which makes URL strings the
 * natural choice for keys in that case. Any async function works — database
 * queries, filesystem reads, expensive computations, etc.
 *
 * @template T The type of value produced by this revalidator.
 *
 * @example
 * const fetchUser: Revalidator<User> = async (key) => {
 *   const id = key.split(':')[1]
 *   const res = await fetch(`/api/users/${id}`)
 *   return res.json()
 * }
 */
export type Revalidator<T> = (key: string) => Promise<T>

// ---------------------------------------------------------------------------
// SWR constructor options
// ---------------------------------------------------------------------------

/**
 * Options accepted by the {@link SWR} constructor.
 *
 * @template T The type of values stored in this cache instance. Defaults to
 *   `unknown`, which forces callers to narrow the return value of `get()`.
 *   Provide a concrete type (e.g. `SWROptions<User>`) to get typed returns
 *   throughout.
 */
export interface SWROptions<T = unknown> {
  /**
   * How long, in **milliseconds**, a cached value is considered **fresh**.
   *
   * During this window every `get()` call returns the cached value immediately
   * without contacting the revalidator.
   *
   * @default 60_000
   */
  maxAge?: number

  /**
   * Extra time, in **milliseconds**, **after** `maxAge` during which the
   * cached value is considered **stale but usable**.
   *
   * A `get()` call in this window returns the old value immediately while
   * silently triggering a background revalidation so the next caller receives
   * fresh data. Once both windows have elapsed the entry is **empty** and the
   * next `get()` will block until the revalidator resolves.
   *
   * @default 30_000
   */
  staleWhileRevalidate?: number

  /**
   * Maximum number of entries the cache may hold at once.
   *
   * When this limit is exceeded the least-recently-used entry is evicted
   * (LRU strategy).
   *
   * @default 10_000
   */
  maxSize?: number

  /**
   * Optional callback invoked whenever a revalidator throws or rejects,
   * whether during a blocking fetch (empty bucket) or a background
   * revalidation (stale bucket).
   *
   * When omitted, errors are silently swallowed so background revalidations
   * never crash the process.
   *
   * @param key   The cache key whose revalidation failed.
   * @param error The error thrown by the revalidator.
   *
   * @default null
   *
   * @example
   * const cache = new SWR({
   *   onError(key, error) {
   *     console.error(`Cache error for "${key}":`, error.message)
   *   },
   * })
   */
  onError?: ((key: string, error: Error) => void) | null

  /**
   * Optional callback invoked after every **successful** revalidation,
   * whether blocking (empty bucket) or background (stale bucket).
   *
   * @param key     The cache key that was revalidated.
   * @param content The freshly fetched value now stored in the cache.
   *
   * @default null
   *
   * @example
   * const cache = new SWR({
   *   onRevalidate(key, content) {
   *     console.log(`"${key}" refreshed`)
   *   },
   * })
   */
  onRevalidate?: ((key: string, content: T) => void) | null
}

// ---------------------------------------------------------------------------
// get() per-call options
// ---------------------------------------------------------------------------

/**
 * Per-call timing overrides for {@link SWR.get}.
 *
 * Useful when different keys have naturally different freshness requirements
 * but you want to share a single cache instance.
 *
 * @example
 * // This key is very short-lived
 * const price = await cache.get('ticker:BTC', fetchPrice, {
 *   maxAge: 2_000,
 *   staleWhileRevalidate: 1_000,
 * })
 */
export interface GetOptions {
  /**
   * Per-call override for {@link SWROptions.maxAge}.
   * When provided, this value is used instead of the instance default for
   * this single `get()` call only.
   */
  maxAge?: number

  /**
   * Per-call override for {@link SWROptions.staleWhileRevalidate}.
   * When provided, this value is used instead of the instance default for
   * this single `get()` call only.
   */
  staleWhileRevalidate?: number
}

// ---------------------------------------------------------------------------
// Bucket (exported so advanced consumers can type-check against it)
// ---------------------------------------------------------------------------

/**
 * Options accepted by the {@link Bucket} constructor.
 *
 * @template T The type of value held by this bucket.
 */
export interface BucketOptions<T> {
  /** Cache key this bucket is associated with. */
  key: string
  /** Initial content. Defaults to `null`. */
  content?: T | null
  /** Initial state. Defaults to `EMPTY`. */
  state?: BucketState
}

/**
 * A single entry in the SWR cache.
 *
 * `Bucket` is an internal implementation detail — you will not normally
 * instantiate or interact with it directly. It is exported so that advanced
 * consumers can reference the type in their own code if needed (e.g. when
 * subclassing or writing tests that inspect cache internals).
 *
 * @template T The type of value held by this bucket.
 */
export declare class Bucket<T = unknown> {
  /**
   * The cache key this bucket is associated with.
   * For the default `fetch`-based revalidator this will be a URL string, but
   * any string accepted by your custom revalidator is valid.
   */
  readonly key: string

  /**
   * The most recently fetched value, or `null` when the bucket is empty or
   * a revalidation has never succeeded.
   */
  content: T | null

  /** Current freshness state of this bucket. */
  state: BucketState

  /**
   * Unix timestamp (ms) of the last successful revalidation.
   * Initialised to `Number.NEGATIVE_INFINITY` so a brand-new bucket is always
   * treated as expired on its very first `update()` call.
   */
  readonly revalidated: number

  /**
   * Whether a revalidation is currently in progress.
   * Used to prevent concurrent duplicate fetches for the same key.
   */
  readonly revalidating: boolean

  /**
   * The error thrown by the most recent failed revalidation attempt, or
   * `null` when the last revalidation succeeded (or has never run).
   */
  readonly error: Error | null

  /** `true` when the bucket has no usable content. */
  get isEmpty(): boolean

  /** `true` when the content is within its `maxAge` window. */
  get isFresh(): boolean

  /**
   * `true` when the content has exceeded `maxAge` but is still within the
   * `staleWhileRevalidate` window.
   */
  get isStale(): boolean

  constructor(options?: BucketOptions<T>)

  /**
   * Calls `revalidator` with {@link key} and stores the resolved value as the
   * new {@link content}.
   *
   * Concurrent calls while a revalidation is already in-flight are ignored —
   * only the first caller triggers a fetch (thundering-herd prevention).
   *
   * @param revalidator Async function that fetches fresh content. Defaults to
   *   the global `fetch`.
   * @throws Re-throws any error produced by the revalidator after storing it
   *   on {@link error}.
   */
  revalidate(revalidator?: Revalidator<T>): Promise<void>

  /**
   * Recalculates {@link state} based on how much time has elapsed since the
   * last revalidation. Call this before reading state getters to ensure they
   * reflect the current wall-clock time.
   *
   * @param options.now       Current Unix timestamp in ms (`Date.now()`).
   * @param options.freshness Max age in ms before content becomes stale.
   * @param options.staleness Max age in ms before content is fully expired.
   */
  update(options: { now: number; freshness: number; staleness: number }): void
}

// ---------------------------------------------------------------------------
// SWR
// ---------------------------------------------------------------------------

/**
 * An in-memory Stale-While-Revalidate (SWR) cache.
 *
 * Each entry moves through three states over time:
 *
 * ```
 * time ──────────────────────────────────────────────────────────►
 *
 * fetch  │◄── maxAge ──►│◄── staleWhileRevalidate ──►│
 *        │              │                             │
 *      EMPTY ──► FRESH ──► STALE ───────────────────► EMPTY ──► ...
 * ```
 *
 * | State     | What `get()` does                                              |
 * |-----------|----------------------------------------------------------------|
 * | **FRESH** | Returns cached value immediately. No network call.             |
 * | **STALE** | Returns cached value immediately + fires background refresh.   |
 * | **EMPTY** | Blocks until revalidator resolves, then returns fresh value.   |
 *
 * Entries are managed with an **LRU** eviction policy: the least-recently-used
 * entry is removed whenever `maxSize` is exceeded.
 *
 * @template T The type of values stored in this cache. When a single `SWR`
 *   instance holds heterogeneous values you can use `unknown` (the default)
 *   and cast at the call site, or use per-call generics on `get<U>()`.
 *
 * @example <caption>Basic usage with the default fetch revalidator</caption>
 * import SWR from '@tbrolin/swr-cache'
 *
 * const cache = new SWR<Response>({ maxAge: 30_000, staleWhileRevalidate: 60_000 })
 * const res = await cache.get('https://api.example.com/users')
 *
 * @example <caption>Custom revalidator returning typed data</caption>
 * import SWR from '@tbrolin/swr-cache'
 *
 * interface User { id: number; name: string }
 *
 * const cache = new SWR<User>({ maxAge: 30_000 })
 * const user = await cache.get(`user:${id}`, (key) => db.users.findById(key.split(':')[1]))
 * // user is User | null
 */
export declare class SWR<T = unknown> {
  /** How long in ms a cached value stays fresh. */
  readonly maxAge: number

  /** Extra ms after `maxAge` during which stale values are still served. */
  readonly staleWhileRevalidate: number

  /** Maximum number of entries before LRU eviction kicks in. */
  readonly maxSize: number

  /** Error callback, or `null` if not set. */
  readonly onError: ((key: string, error: Error) => void) | null

  /** Revalidation callback, or `null` if not set. */
  readonly onRevalidate: ((key: string, content: T) => void) | null

  /** The number of entries currently held in the cache. */
  get size(): number

  constructor(options?: SWROptions<T>)

  /**
   * Returns the cached value for `key`, using the instance-level type `T`.
   *
   * Fetches via `revalidator` if the entry is empty or expired, and returns
   * the stale value (while revalidating in the background) if the entry is
   * stale.
   *
   * @param key         Cache key.
   * @param revalidator Async function called with `key` to produce a fresh
   *                    value. Defaults to the global `fetch`.
   * @param options     Per-call timing overrides.
   * @returns           The cached or freshly fetched value, or `null` if the
   *                    revalidator failed and no stale content is available.
   */
  get(key: string, revalidator?: Revalidator<T>, options?: GetOptions): Promise<T | null>

  /**
   * Returns the cached value for `key`, with a **per-call type override** `U`.
   *
   * Use this overload when a single `SWR<unknown>` instance stores values of
   * different shapes and you want to narrow the return type at the call site.
   *
   * @template U The expected type of the value for this specific key.
   *
   * @example
   * const cache = new SWR()
   *
   * const user = await cache.get<User>('user:1', fetchUser)
   * const post = await cache.get<Post>('post:42', fetchPost)
   */
  get<U>(key: string, revalidator?: Revalidator<U>, options?: GetOptions): Promise<U | null>

  /**
   * Returns `true` if the cache holds an entry for `key`, regardless of
   * whether it is fresh, stale, or empty.
   *
   * Does **not** trigger revalidation.
   *
   * @example
   * cache.has('user:1') // true | false
   */
  has(key: string): boolean

  /**
   * Removes a single entry from the cache.
   *
   * Useful for manual invalidation after a mutation (POST / PUT / DELETE) so
   * the next `get()` fetches fresh data from the origin.
   *
   * @returns `true` if the entry existed and was removed, `false` otherwise.
   *
   * @example
   * await api.updateUser(id, payload)
   * cache.delete(`user:${id}`)
   */
  delete(key: string): boolean

  /**
   * Removes **all** entries from the cache.
   *
   * Every subsequent `get()` call will block on a fresh revalidation until
   * the cache is repopulated.
   *
   * @example
   * // Invalidate everything on logout
   * cache.clear()
   */
  clear(): void
}

export default SWR