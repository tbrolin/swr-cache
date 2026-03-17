# swr-cache
This is a sample implementation of the Stale-While-Revalidate
cache strategy in javascript. It is very general but reliable.

The cache is an in memory cache that can be used to store results
from async functions.

## Installation
This is not a proper package so to use clone the repository and
use the code in your project.

```bash
npm install
npm run test
```

## Usage

The cache is a class that can be used to store results from
async functions. Create a new cache and use the `get` method
to get the value from the cache. The get method takes a key
and will return the value based on a revalidator function