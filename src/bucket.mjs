/**
 * @fileoverview Internal cache bucket used by the SWR cache.
 *
 * Each bucket holds the cached content for a single key together with the
 * metadata needed to decide whether that content is fresh, stale, or expired.
 * You will not normally interact with this class directly — it is managed
 * entirely by {@link SWR}.
 */

/** @type {'empty'} */
export const EMPTY = 'empty'

/** @type {'fresh'} */
export const FRESH = 'fresh'

/** @type {'stale'} */
export const STALE = 'stale'

/**
 * The set of states a bucket can be in at any given time.
 *
 * - **`empty`** — No content is available (never fetched, or fully expired).
 * - **`fresh`** — Content was fetched recently and can be served directly.
 * - **`stale`** — Content is older than `maxAge` but still within the
 *   `staleWhileRevalidate` window; it can be served immediately while a
 *   background refresh runs in parallel.
 *
 * @typedef {'empty' | 'fresh' | 'stale'} BucketState
 */

/**
 * A single entry in the SWR cache.
 *
 * @template T
 */
export default class Bucket {
  /**
   * The cache key this bucket is associated with.
   * For the default `fetch`-based revalidator this will be a URL string, but
   * any string accepted by your custom revalidator is valid.
   *
   * @type {string}
   */
  key

  /**
   * The most recently fetched value, or `null` when the bucket is empty.
   *
   * @type {T | null}
   */
  content

  /**
   * Current freshness state of this bucket.
   *
   * @type {BucketState}
   */
  state

  /**
   * Unix timestamp (ms) of the last successful revalidation.
   * Initialised to `Number.NEGATIVE_INFINITY` so that a brand-new bucket is
   * always treated as expired on the very first {@link update} call.
   *
   * @type {number}
   */
  revalidated

  /**
   * Whether a revalidation is currently in progress.
   * Used to prevent concurrent duplicate fetches for the same key.
   *
   * @type {boolean}
   */
  revalidating

  /**
   * The error thrown by the most recent failed revalidation attempt, or
   * `null` when the last revalidation succeeded (or has not run yet).
   *
   * @type {Error | null}
   */
  error

  /**
   * Creates a new Bucket.
   *
   * @param {object}      [options]
   * @param {string}      [options.key]     - Cache key.
   * @param {T | null}    [options.content] - Initial content (default `null`).
   * @param {BucketState} [options.state]   - Initial state (default `EMPTY`).
   */
  constructor ({ key, content = null, state = EMPTY } = {}) {
    this.key = key
    this.content = content
    this.state = state
    this.revalidated = Number.NEGATIVE_INFINITY
    this.revalidating = false
    this.error = null
  }

  /**
   * Calls `revalidator` with {@link key} and stores the resolved value as the
   * new {@link content}.
   *
   * Concurrent calls while a revalidation is already in flight are ignored —
   * only the first caller triggers a fetch.  This prevents the "thundering
   * herd" problem when many requests arrive for the same stale key at once.
   *
   * If the revalidator rejects, the error is stored on {@link error},
   * `revalidating` is reset to `false` (via `finally`), and the error is
   * re-thrown so the caller can decide how to handle it.
   *
   * @param {(key: string) => Promise<T>} [revalidator] - Async function that
   *   fetches fresh content for {@link key}.  Defaults to the global `fetch`.
   * @returns {Promise<void>}
   * @throws {Error} Re-throws any error produced by the revalidator.
   */
  async revalidate (revalidator = fetch) {
    if (this.revalidating) {
      return
    }
    this.revalidating = true
    this.error = null
    try {
      this.content = await revalidator(this.key)
      this.revalidated = Date.now()
    } catch (err) {
      this.error = err
      throw err
    } finally {
      this.revalidating = false
    }
  }

  /**
   * Recalculates {@link state} based on how much time has elapsed since the
   * last revalidation.
   *
   * Call this before reading {@link isFresh}, {@link isStale}, or
   * {@link isEmpty} to ensure the state reflects the current wall-clock time.
   *
   * | Condition                              | Resulting state |
   * |----------------------------------------|-----------------|
   * | `now - revalidated <= freshness`       | `FRESH`         |
   * | `now - revalidated <= staleness`       | `STALE`         |
   * | `now - revalidated >  staleness`       | `EMPTY`         |
   *
   * When the bucket transitions to `EMPTY` its {@link content} is set to
   * `null` to allow the old value to be garbage-collected.
   *
   * @param {object} options
   * @param {number} options.now       - Current Unix timestamp in ms
   *   (`Date.now()`).
   * @param {number} options.freshness - Maximum age in ms before content
   *   becomes stale (corresponds to `maxAge`).
   * @param {number} options.staleness - Maximum age in ms before content is
   *   considered fully expired (corresponds to `maxAge + staleWhileRevalidate`).
   * @returns {void}
   */
  update ({ now, freshness, staleness }) {
    if ((now - this.revalidated) <= freshness) {
      this.state = FRESH
    } else if ((now - this.revalidated) <= staleness) {
      this.state = STALE
    } else {
      this.state = EMPTY
      this.content = null
    }
  }

  /**
   * `true` when the bucket has no usable content (never fetched, or fully
   * expired).  A call to {@link SWR#get} will block until fresh content is
   * fetched before returning.
   *
   * @type {boolean}
   */
  get isEmpty () {
    return this.state === EMPTY
  }

  /**
   * `true` when the cached content is still within its `maxAge` window and
   * can be returned directly without any fetch.
   *
   * @type {boolean}
   */
  get isFresh () {
    return this.state === FRESH
  }

  /**
   * `true` when the cached content has exceeded `maxAge` but is still within
   * the `staleWhileRevalidate` window.  The stale content is returned
   * immediately while a background fetch runs in parallel.
   *
   * @type {boolean}
   */
  get isStale () {
    return this.state === STALE
  }
}