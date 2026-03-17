import Bucket from './bucket.mjs'

export default class SWR {
  constructor ({
    maxAge = 60_000,
    staleWhileRevalidate = 30_000,
    maxSize = 10_000,
    onError = null,
    onRevalidate = null,
  } = {}) {
    this.buckets = new Map()
    this.maxAge = maxAge
    this.staleWhileRevalidate = staleWhileRevalidate
    this.maxSize = maxSize
    this.onError = onError
    this.onRevalidate = onRevalidate
  }

  get size () {
    return this.buckets.size
  }

  has (key) {
    return this.buckets.has(key)
  }

  delete (key) {
    return this.buckets.delete(key)
  }

  clear () {
    this.buckets.clear()
  }

  #useKey (key) {
    if (this.buckets.has(key)) {
      const bucket = this.buckets.get(key)
      this.buckets.delete(key)
      this.buckets.set(key, bucket)
    }
  }

  #limitSize () {
    while (this.buckets.size > this.maxSize) {
      const key = this.buckets.keys().next().value
      this.buckets.delete(key)
    }
  }

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
