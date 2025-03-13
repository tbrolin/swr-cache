export const [EMPTY, FRESH, STALE] = ['empty', 'fresh', 'stale']

export default class Bucket {
  constructor ({ key, content = null, state = EMPTY } = {}) {
    const now = Date.now ()
    this.key = key
    this.content = content
    this.state = state
    this.revalidated = Number.NEGATIVE_INFINITY
    this.revalidating = false
  }
  
  async revalidate (revalidator = fetch) {
    if (this.revalidating) {
      return
    }
    this.revalidating = true
    const content = revalidator (this.key)
    this.content = await content
    this.revalidated = Date.now ()
    this.revalidating = false
  }
  
  update ({ now, freshness, staleness }) {
    if ((now - this.revalidated) <= freshness) {
      this.state = FRESH
    } else if ((now - this.revalidated) <= staleness) {
      this.state = STALE
    } else {
      this.state = EMPTY
      delete this.content
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
