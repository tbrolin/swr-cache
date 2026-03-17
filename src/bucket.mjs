export const [EMPTY, FRESH, STALE] = ['empty', 'fresh', 'stale']

export default class Bucket {
  constructor ({ key, content = null, state = EMPTY } = {}) {
    this.key = key
    this.content = content
    this.state = state
    this.revalidated = Number.NEGATIVE_INFINITY
    this.revalidating = false
    this.error = null
  }

  async revalidate (revalidator = fetch) {
    if (this.revalidating) {
      return
    }
    this.revalidating = true
    this.error = null
    try {
      this.content = await revalidator (this.key)
      this.revalidated = Date.now ()
    } catch (err) {
      this.error = err
      throw err
    } finally {
      this.revalidating = false
    }
  }

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

  get isEmpty () {
    return this.state === EMPTY
  }
  get isFresh () {
    return this.state === FRESH
  }
  get isStale () {
    return this.state === STALE
  }
}