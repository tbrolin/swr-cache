# @tobiasbrolin/swr-cache

An in-memory [Stale-While-Revalidate](https://web.dev/stale-while-revalidate/) cache for JavaScript.

Serve cached data instantly, refresh it silently in the background.

---

## Table of Contents

- [How it works](#how-it-works)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Examples](#examples)
  - [Fetching JSON from a REST API](#fetching-json-from-a-rest-api)
  - [Custom revalidator (database query)](#custom-revalidator-database-query)
  - [Multiple keys, one cache](#multiple-keys-one-cache)
  - [Per-call timing overrides](#per-call-timing-overrides)
  - [Manual invalidation after a mutation](#manual-invalidation-after-a-mutation)
  - [Error handling with onError](#error-handling-with-onerror)
  - [Observing refreshes with onRevalidate](#observing-refreshes-with-onrevalidate)
  - [Logging cache hits and misses](#logging-cache-hits-and-misses)
- [API reference](#api-reference)
  - [new SWR(options)](#new-swroptions)
  - [cache.get(key, revalidator, options)](#cachegetkey-revalidator-options)
  - [cache.has(key)](#cachehaskey)
  - [cache.delete(key)](#cachedeletkey)
  - [cache.clear()](#cacheclear)
  - [cache.size](#cachesize)
- [Cache entry lifecycle](#cache-entry-lifecycle)
- [LRU eviction](#lru-eviction)
- [Running the tests](#running-the-tests)

---

## How it works

Every cache entry moves through three states over time:

```
time ──────────────────────────────────────────────────────────────►

fetch   │◄──── maxAge ────►│◄──── staleWhileRevalidate ────►│
        │                  │                                 │
      EMPTY  ──►  FRESH  ──►  STALE  ──────────────────────►  EMPTY  ──► ...
```

| State     | What `get()` does                                                                 |
|-----------|-----------------------------------------------------------------------------------|
| **FRESH** | Returns the cached value immediately. No network call is made.                    |
| **STALE** | Returns the cached value immediately **and** fires a background revalidation.     |
| **EMPTY** | Blocks the caller, fetches fresh data, then returns it.                           |

The stale-while-revalidate pattern gives you the best of both worlds: responses are always instant (no waiting for the network in the hot path), and the data is kept up-to-date in the background.

---

## Installation

```bash
npm install @tobiasbrolin/swr-cache
# or
yarn add @tobiasbrolin/swr-cache
```

TypeScript types are included — no separate `@types` package needed.

---

## Quick start

```js
import SWR from '@tobiasbrolin/swr-cache'

const cache = new SWR({
  maxAge: 30_000,              // serve from cache for 30 s
  staleWhileRevalidate: 60_000 // accept stale data for another 60 s
})

// First call — cache is empty, blocks until data is fetched
const users = await cache.get('https://api.example.com/users')

// Subsequent calls within 30 s — returns instantly from cache
const users2 = await cache.get('https://api.example.com/users')

// Call after 30–90 s — returns stale data instantly,
// silently refreshes the cache in the background
const users3 = await cache.get('https://api.example.com/users')
```

---

## Examples

### Fetching JSON from a REST API

The default revalidator is the global `fetch`, so a URL is all you need as a key. If you want the parsed JSON body rather than the raw `Response` object, supply a custom revalidator:

```js
import SWR from '@tobiasbrolin/swr-cache'

const cache = new SWR({ maxAge: 60_000, staleWhileRevalidate: 120_000 })

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const posts = await cache.get('https://api.example.com/posts', fetchJSON)
console.log(posts[0].title)
```

---

### Custom revalidator (database query)

The revalidator can be any async function that accepts a key string and returns a value. This makes `@tobiasbrolin/swr-cache` useful far beyond HTTP — wrap database queries, filesystem reads, or expensive computations.

```js
import SWR from '@tobiasbrolin/swr-cache'
import db from './db.mjs'

const cache = new SWR({ maxAge: 30_000, staleWhileRevalidate: 30_000 })

async function fetchUser(key) {
  const id = key.split(':')[1]
  return db.users.findById(id)
}

// The key can be any string — a namespaced ID is a common pattern
const user = await cache.get('user:42', fetchUser)
console.log(user.name)
```

---

### Multiple keys, one cache

One `SWR` instance can hold entries for many different keys at once. Each key is cached and revalidated independently.

```js
import SWR from '@tobiasbrolin/swr-cache'

const cache = new SWR({ maxAge: 30_000, staleWhileRevalidate: 30_000 })

async function fetchJSON(url) {
  const res = await fetch(url)
  return res.json()
}

const BASE = 'https://api.example.com'

// All three run concurrently — each key gets its own bucket
const [users, posts, comments] = await Promise.all([
  cache.get(`${BASE}/users`,    fetchJSON),
  cache.get(`${BASE}/posts`,    fetchJSON),
  cache.get(`${BASE}/comments`, fetchJSON),
])
```

---

### Per-call timing overrides

Different data has different freshness requirements. You can override `maxAge` and `staleWhileRevalidate` per `get()` call without creating separate cache instances.

```js
import SWR from '@tobiasbrolin/swr-cache'

const cache = new SWR({ maxAge: 60_000, staleWhileRevalidate: 60_000 })

async function fetchJSON(url) {
  const res = await fetch(url)
  return res.json()
}

// Stock prices: very short-lived, stay fresh for just 2 s
const price = await cache.get('https://api.example.com/ticker/BTC', fetchJSON, {
  maxAge: 2_000,
  staleWhileRevalidate: 1_000,
})

// User profile: changes rarely, long freshness window is fine
const profile = await cache.get('https://api.example.com/me', fetchJSON, {
  maxAge: 300_000,  // 5 minutes
  staleWhileRevalidate: 600_000,
})
```

---

### Manual invalidation after a mutation

When you mutate data on the server (POST / PUT / DELETE) you usually want the next read to fetch fresh data immediately rather than serving a stale cached copy.

```js
import SWR from '@tobiasbrolin/swr-cache'

const cache = new SWR({ maxAge: 60_000, staleWhileRevalidate: 30_000 })

async function fetchUser(key) {
  const id = key.split(':')[1]
  const res = await fetch(`/api/users/${id}`)
  return res.json()
}

async function updateUser(id, payload) {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })

  if (!res.ok) throw new Error('Update failed')

  // Remove the stale entry so the next read goes straight to the server
  cache.delete(`user:${id}`)
}

// Initial read — populates the cache
let user = await cache.get('user:42', fetchUser)

// Mutate + invalidate
await updateUser(42, { name: 'Alice' })

// This will block briefly while fresh data is fetched (bucket is now empty)
user = await cache.get('user:42', fetchUser)
console.log(user.name) // 'Alice'
```

To invalidate everything at once — for example when a user logs out — use `clear()`:

```js
function onLogout() {
  cache.clear()
}
```

---

### Error handling with `onError`

By default, errors that occur during background (stale) revalidation are silently swallowed — the caller already received the stale value and there is nobody to propagate the error to. Use the `onError` hook to log or report these failures.

```js
import SWR from '@tobiasbrolin/swr-cache'

const cache = new SWR({
  maxAge: 30_000,
  staleWhileRevalidate: 30_000,
  onError(key, error) {
    console.error(`[swr-cache] revalidation failed for "${key}":`, error.message)
    // You could also send this to an error monitoring service:
    // Sentry.captureException(error, { extra: { key } })
  },
})

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

const data = await cache.get('https://api.example.com/data', fetchJSON)
```

When the cache is **empty** and the revalidator fails, `get()` resolves with `null` (the bucket's initial content) and `onError` is called. This prevents `get()` from ever throwing, keeping your application stable even under network failures.

---

### Observing refreshes with `onRevalidate`

The `onRevalidate` hook fires after every successful revalidation. Use it to log cache refreshes, warm secondary caches, or broadcast updates to other parts of your application.

```js
import SWR from '@tobiasbrolin/swr-cache'

const cache = new SWR({
  maxAge: 10_000,
  staleWhileRevalidate: 20_000,
  onRevalidate(key, newValue) {
    console.log(`[swr-cache] "${key}" refreshed:`, newValue)
  },
})
```

---

### Logging cache hits and misses

Use `has()` before calling `get()` to distinguish hits from misses for metrics or debugging:

```js
import SWR from '@tobiasbrolin/swr-cache'

const cache = new SWR({ maxAge: 60_000, staleWhileRevalidate: 30_000 })
const metrics = { hits: 0, misses: 0 }

async function cachedFetch(url) {
  const isHit = cache.has(url)
  metrics[isHit ? 'hits' : 'misses']++
  return cache.get(url, fetch)
}
```

> **Note:** `has()` returns `true` for stale entries as well. If you need to distinguish fresh from stale you can inspect `cache.buckets` directly, but that is generally not necessary.

---

## API reference

### `new SWR(options)`

Creates a new cache instance.

```js
const cache = new SWR({
  maxAge:               60_000,  // ms — default 60 000
  staleWhileRevalidate: 30_000,  // ms — default 30 000
  maxSize:              10_000,  // entries — default 10 000
  onError:              null,    // (key, error) => void
  onRevalidate:         null,    // (key, content) => void
})
```

| Option                  | Type                             | Default    | Description |
|-------------------------|----------------------------------|------------|-------------|
| `maxAge`                | `number`                         | `60_000`   | Milliseconds a cached value stays **fresh**. |
| `staleWhileRevalidate`  | `number`                         | `30_000`   | Milliseconds **after** `maxAge` during which stale values are still served while revalidating in the background. |
| `maxSize`               | `number`                         | `10_000`   | Maximum number of entries. Least-recently-used entries are evicted when this limit is exceeded. |
| `onError`               | `(key, error) => void \| null`   | `null`     | Called whenever a revalidator throws or rejects. |
| `onRevalidate`          | `(key, content) => void \| null` | `null`     | Called after every successful revalidation. |

---

### `cache.get(key, revalidator, options)`

Returns the cached value for `key`, fetching it if necessary.

```js
const value = await cache.get(key)
const value = await cache.get(key, revalidator)
const value = await cache.get(key, revalidator, { maxAge, staleWhileRevalidate })
```

| Parameter                        | Type                         | Default          | Description |
|----------------------------------|------------------------------|------------------|-------------|
| `key`                            | `string`                     | —                | Cache key. When using the default revalidator this should be a URL. |
| `revalidator`                    | `async (key: string) => any` | `fetch`          | Called with `key` to produce a fresh value. |
| `options.maxAge`                 | `number`                     | Instance default | Per-call override for `maxAge`. |
| `options.staleWhileRevalidate`   | `number`                     | Instance default | Per-call override for `staleWhileRevalidate`. |

**Returns:** `Promise<any>` — the cached or freshly fetched value.

---

### `cache.has(key)`

Returns `true` if the cache holds an entry for `key` (regardless of state). Does **not** trigger revalidation.

```js
cache.has('user:1') // true | false
```

---

### `cache.delete(key)`

Removes a single entry from the cache. Returns `true` if the entry existed, `false` otherwise. The next `get()` for that key will block on a fresh fetch.

```js
cache.delete('user:1') // true
```

---

### `cache.clear()`

Removes all entries from the cache. Every subsequent `get()` call will block until fresh data is fetched.

```js
cache.clear()
```

---

### `cache.size`

The number of entries currently held in the cache.

```js
console.log(cache.size) // 42
```

---

## Cache entry lifecycle

The diagram below shows how a single entry ages over time after its first successful fetch:

```
 t=0          t=maxAge           t=maxAge+staleWhileRevalidate
  │                │                         │
  ▼                ▼                         ▼
──●────────────────●─────────────────────────●──────────►
  │◄── FRESH ─────►│◄────── STALE ──────────►│◄── EMPTY
  │                │                         │
  │ get() returns  │ get() returns old value  │ get() blocks,
  │ cached value   │ immediately + triggers   │ fetches fresh
  │ immediately    │ background revalidation  │ data, returns it
```

A successful background revalidation at any point during the STALE window resets the clock back to `t=0`, making the entry FRESH again.

---

## LRU eviction

The cache uses a **Least-Recently-Used (LRU)** eviction policy backed by JavaScript's `Map`, which preserves insertion order. Every time an entry is accessed via `get()` it is moved to the end of the map (most-recently-used position). When the number of entries exceeds `maxSize`, entries are removed from the front of the map (least-recently-used position) until the cache is within its limit.

```
maxSize = 3

get(A) → [A]
get(B) → [A, B]
get(C) → [A, B, C]   ← full

get(A) → [B, C, A]   ← A moved to end (most recent)

get(D) → evict B → [C, A, D]
```

---

## Running the tests

```bash
yarn install
yarn test
```

The test suite uses [Jest](https://jestjs.io/) with native ES module support, and runs a TypeScript type-check automatically before each test run.

```
 PASS  src/bucket.test.mjs
 PASS  src/swr.test.mjs

Tests: 32 passed
```
