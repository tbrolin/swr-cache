import Bucket from './bucket.mjs'

export default class SWR {
  constructor ({ 
    maxAge = 60,
    staleWhileRevalidate = 30,
    maxSize = 10000,
  } = {}) {
    this.buckets = new Map ()
    this.freshness = maxAge
    this.staleness = maxAge + staleWhileRevalidate
    this.maxSize = maxSize
  }
  
  useKey (key) {
    if (this.buckets.has (key)) {
      const bucket = this.buckets.get (key)
      this.buckets.delete (key)
      this.buckets.set (key, bucket)
    }
  }
  
  limitSize () {
    while (this.buckets.size > this.maxSize) {
      const key = this.buckets.keys ().next ().value
      this.buckets.delete (key)
    }
  }

  async get (key, fetcher = fetch) {
    let bucket = this.buckets.get (key)
    if (!bucket) {
      bucket = new Bucket ({ key })
      this.buckets.set (key, bucket)
      this.limitSize ()
    }
    this.useKey (key)
    bucket.update ({
      now: Date.now (),
      freshness: this.freshness,
      staleness: this.staleness,
    })
    if (bucket.isFresh) {
      return bucket.content
    }
    if (bucket.isStale) {
      bucket.revalidate (fetcher)
      return bucket.content
    }
    if (bucket.isEmpty) {
      await bucket.revalidate (fetcher)
      return bucket.content
    }
  }
}