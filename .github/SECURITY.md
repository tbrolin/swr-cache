# Security Policy

## Supported Versions

Only the latest published version of `@tobiasbrolin/swr-cache` receives security fixes.

| Version | Supported |
|---------|-----------|
| latest  | ✅        |
| older   | ❌        |

Once a fix is released, the previous version is immediately unsupported. Please always upgrade to the latest version.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report vulnerabilities privately using GitHub's built-in mechanism:

1. Go to the [Security tab](https://github.com/tbrolin/swr-cache/security) of this repository
2. Click **"Report a vulnerability"**
3. Fill in the details described below

### What to include

A useful report contains:

- A clear description of the vulnerability and its potential impact
- The version(s) affected
- Step-by-step instructions to reproduce the issue
- Any relevant code snippets, logs, or proof-of-concept

The more detail you provide, the faster the issue can be assessed and resolved.

## Response Process

| Step | Timeframe |
|------|-----------|
| Initial acknowledgement | Within **48 hours** |
| Assessment and confirmation | Within **7 days** |
| Fix released (if confirmed) | Within **30 days** for critical issues |

If a reported vulnerability is declined, you will receive an explanation of why it was not considered a security risk.

## Disclosure Policy

This project follows **coordinated disclosure**:

- Confirmed vulnerabilities will be fixed before any public disclosure
- A [GitHub Security Advisory](https://github.com/tbrolin/swr-cache/security/advisories) will be published once the fix is released
- Credit will be given to the reporter in the advisory unless they prefer to remain anonymous

## Scope

### In scope

- Vulnerabilities in `src/swr.mjs` or `src/bucket.mjs` that could cause unintended data exposure, cache poisoning, or denial of service when the library is used as documented

### Out of scope

- Vulnerabilities in `devDependencies` (Jest, TypeScript) — please report those to their respective projects
- Issues that require the attacker to already have arbitrary code execution on the host
- General bugs that do not have a security impact — please open a [regular issue](https://github.com/tbrolin/swr-cache/issues) instead

## A note on this library's architecture

`@tobiasbrolin/swr-cache` is a **pure in-memory cache**. It holds no credentials, makes no outbound connections itself, and stores only what the caller explicitly puts into it via a revalidator function. The primary security consideration for consumers is ensuring that **revalidator functions** do not inadvertently expose sensitive cached values across cache keys.