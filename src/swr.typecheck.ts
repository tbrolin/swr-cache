/**
 * Type-check smoke test for index.d.ts.
 *
 * This file is never executed — it is only fed to `tsc --noEmit` to verify
 * that the declaration file correctly models the public API.  Every line that
 * is expected to be a type error is marked with @ts-expect-error so the
 * compiler enforces the failure rather than silently accepting it.
 */

import SWR, { EMPTY, FRESH, STALE, Bucket } from '../index'
import type {
  BucketState,
  BucketOptions,
  SWROptions,
  GetOptions,
  Revalidator,
} from '../index'

// ---------------------------------------------------------------------------
// BucketState
// ---------------------------------------------------------------------------

const s1: BucketState = 'empty'
const s2: BucketState = 'fresh'
const s3: BucketState = 'stale'

// @ts-expect-error — 'expired' is not a valid BucketState
const sBad: BucketState = 'expired'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const e: 'empty' = EMPTY
const f: 'fresh' = FRESH
const st: 'stale' = STALE

// ---------------------------------------------------------------------------
// Revalidator<T>
// ---------------------------------------------------------------------------

interface User { id: number; name: string }
interface Post { id: number; title: string }

const fetchUser: Revalidator<User> = async (key) => {
  const id = key.split(':')[1]
  const res = await fetch(`/api/users/${id}`)
  return res.json() as unknown as User
}

// A Revalidator must return a Promise — sync functions are not valid
// @ts-expect-error — returns string, not Promise<string>
const badRevalidator: Revalidator<string> = (key) => key

// ---------------------------------------------------------------------------
// SWROptions<T>
// ---------------------------------------------------------------------------

const opts1: SWROptions<User> = {}

const opts2: SWROptions<User> = {
  maxAge: 30_000,
  staleWhileRevalidate: 60_000,
  maxSize: 500,
  onError: (key: string, error: Error) => {
    console.error(key, error.message)
  },
  onRevalidate: (key: string, content: User) => {
    // content is typed as User, so accessing .name is valid
    console.log(key, content.name)
  },
}

// onRevalidate content type must match the SWROptions generic
const optsBadRevalidate: SWROptions<User> = {
  // @ts-expect-error — content parameter is Post but SWROptions<User> expects User
  onRevalidate: (key: string, content: Post) => {
    console.log(content.title)
  },
}

// @ts-expect-error — maxAge must be a number, not a string
const optsBadMaxAge: SWROptions = { maxAge: '60s' }

// ---------------------------------------------------------------------------
// GetOptions
// ---------------------------------------------------------------------------

const getOpts: GetOptions = {
  maxAge: 5_000,
  staleWhileRevalidate: 2_000,
}

// @ts-expect-error — unknown field
const getBadOpts: GetOptions = { ttl: 5_000 }

// ---------------------------------------------------------------------------
// Bucket<T>
// ---------------------------------------------------------------------------

const bucketOpts: BucketOptions<User> = {
  key: 'user:1',
  content: { id: 1, name: 'Alice' },
  state: 'fresh',
}

const bucket = new Bucket<User>(bucketOpts)

// key is readonly string
const _key: string = bucket.key

// content is User | null
const _content: User | null = bucket.content

// state is BucketState
const _state: BucketState = bucket.state

// revalidated is readonly number
const _revalidated: number = bucket.revalidated

// revalidating is readonly boolean
const _revalidating: boolean = bucket.revalidating

// error is readonly Error | null
const _error: Error | null = bucket.error

// state getters return boolean
const _isEmpty: boolean = bucket.isEmpty
const _isFresh: boolean = bucket.isFresh
const _isStale: boolean = bucket.isStale

// revalidate() returns Promise<void>
const _revalidateReturn: Promise<void> = bucket.revalidate(fetchUser)

// revalidate() can be called with no argument (defaults to global fetch)
const _revalidateDefault: Promise<void> = bucket.revalidate()

// update() takes the correct shape
bucket.update({ now: Date.now(), freshness: 30_000, staleness: 90_000 })

// @ts-expect-error — missing required fields
bucket.update({ now: Date.now() })

// @ts-expect-error — readonly key cannot be assigned
bucket.key = 'user:2'

// @ts-expect-error — readonly revalidating cannot be assigned
bucket.revalidating = true

// ---------------------------------------------------------------------------
// new SWR<T>() — typed instance
// ---------------------------------------------------------------------------

const userCache = new SWR<User>({
  maxAge: 30_000,
  staleWhileRevalidate: 60_000,
  maxSize: 500,
  onError: (key, error) => console.error(key, error),
  onRevalidate: (key, content) => {
    // content is narrowed to User here
    const _name: string = content.name
  },
})

// Readable public properties
const _maxAge: number = userCache.maxAge
const _swr: number = userCache.staleWhileRevalidate
const _maxSize: number = userCache.maxSize
const _size: number = userCache.size
const _onError: ((key: string, error: Error) => void) | null = userCache.onError
const _onRevalidate: ((key: string, content: User) => void) | null = userCache.onRevalidate

// @ts-expect-error — readonly, cannot be assigned
userCache.maxAge = 1_000

// has() returns boolean
const _has: boolean = userCache.has('user:1')

// delete() returns boolean
const _delete: boolean = userCache.delete('user:1')

// clear() returns void
const _clear: void = userCache.clear()

// ---------------------------------------------------------------------------
// get() — typed instance, instance-level type T used
// ---------------------------------------------------------------------------

// Returns Promise<User | null> on a SWR<User> instance
const getResult: Promise<User | null> = userCache.get('user:1', fetchUser)

// Default revalidator (fetch) is acceptable — result is still Promise<User | null>
const getDefault: Promise<User | null> = userCache.get('user:1')

// Per-call options are accepted
const getWithOpts: Promise<User | null> = userCache.get('user:1', fetchUser, {
  maxAge: 5_000,
  staleWhileRevalidate: 2_000,
})

// @ts-expect-error — result cannot be assigned to Post | null on a SWR<User>
const getWrongType: Promise<Post | null> = userCache.get('user:1', fetchUser)

// ---------------------------------------------------------------------------
// get<U>() — per-call generic override on SWR<unknown>
// ---------------------------------------------------------------------------

const mixedCache = new SWR()

// Per-call generic narrows the return type
const u: Promise<User | null> = mixedCache.get<User>('user:1', fetchUser)
const p: Promise<Post | null> = mixedCache.get<Post>('post:42', async () => ({
  id: 42,
  title: 'Hello',
}))

// Without a per-call generic, returns Promise<unknown | null>
const unknown: Promise<unknown | null> = mixedCache.get('anything')

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

// The default export is the SWR class itself, not an instance
const CacheClass: typeof SWR = SWR
const instance = new CacheClass({ maxAge: 10_000 })
const _instanceSize: number = instance.size