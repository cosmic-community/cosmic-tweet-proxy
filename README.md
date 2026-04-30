# cosmic-tweet-proxy
![App Preview](https://imgix.cosmicjs.com/5834fb30-4447-11f1-9f85-e7af420a77a5-agent-upload-1777520863785-988hic.png?w=1200&h=630&fit=crop&auto=format,compress)

A minimal Next.js microservice that proxies tweet creation to the X (Twitter) API v2 with full OAuth 1.0a signing and Bearer token authentication for incoming requests.

## Features

- 🐦 **POST /api/tweet** — Post tweets to X (Twitter) API v2
- 💬 **Reply support** — Optional `reply_to_tweet_id` for threaded replies
- 🔐 **Bearer token auth** — Incoming request authentication via `API_SECRET_KEY`
- 🔏 **OAuth 1.0a signing** — Full HMAC-SHA1 with nonce, timestamp, and signature base string
- ✅ **GET /api/health** — Health check endpoint returning `{ status: "ok" }`
- 📦 **Zero dependencies beyond Next.js** — Uses Node.js built-in `crypto` module

## Clone this Project

Want to create your own version of this project with all the content and structure? Clone this Cosmic bucket and code repository to get started instantly:

[![Clone this Project](https://img.shields.io/badge/Clone%20this%20Project-29abe2?style=for-the-badge&logo=cosmic&logoColor=white)](https://app.cosmicjs.com/projects/new?clone_bucket=69cabf3abbe15b6f7e44445c&clone_repository=69f2d228ad4b5e824c09d0a5)

## Prompts

This application was built using the following prompts to generate the content structure and code:

### Content Model Prompt

> "Create content models for: A minimal Next.js microservice with a single API route POST /api/tweet that:
> 1. Accepts a JSON body with { "text": "..." } and optional "reply_to_tweet_id"
> 2. Authenticates incoming requests using a secret key passed as Authorization header (Bearer token matching env var API_SECRET_KEY)
> 3. Signs the request to X (Twitter) API v2 using OAuth 1.0a with HMAC-SHA1
> 4. Posts the tweet to https://api.twitter.com/2/tweets using the signed OAuth header
> 5. Returns { success: true, tweet_id: "...", tweet_url: "..." } on success or { success: false, error: "..." } on failure
>
> Environment variables needed:
> - X_CONSUMER_KEY
> - X_CONSUMER_SECRET
> - X_ACCESS_TOKEN
> - X_ACCESS_TOKEN_SECRET
> - API_SECRET_KEY (used to authenticate incoming requests to this microservice)
>
> The OAuth 1.0a signing must:
> - Generate a unique oauth_nonce (random alphanumeric string)
> - Use current Unix timestamp for oauth_timestamp
> - Build the signature base string from: HTTP method + base URL + sorted/encoded parameters
> - Sign with HMAC-SHA1 using composite key (consumer_secret + "&" + token_secret)
> - Build Authorization header with all oauth_ parameters
>
> No UI needed. Just the API route. Include a GET /api/health endpoint that returns { status: "ok" }. Keep it minimal and clean."

### Code Generation Prompt

> A minimal Next.js microservice with a single API route POST /api/tweet that:
> 1. Accepts a JSON body with { "text": "..." } and optional "reply_to_tweet_id"
> 2. Authenticates incoming requests using a secret key passed as Authorization header (Bearer token matching env var API_SECRET_KEY)
> 3. Signs the request to X (Twitter) API v2 using OAuth 1.0a with HMAC-SHA1
> 4. Posts the tweet to https://api.twitter.com/2/tweets using the signed OAuth header
> 5. Returns { success: true, tweet_id: "...", tweet_url: "..." } on success or { success: false, error: "..." } on failure
>
> No UI needed. Just the API route. Include a GET /api/health endpoint that returns { status: "ok" }. Keep it minimal and clean.

The app has been tailored to work with your existing Cosmic content structure and includes all the features requested above.

## Technologies

- [Next.js 16](https://nextjs.org/) — React framework with App Router
- [TypeScript](https://www.typescriptlang.org/) — Type-safe JavaScript
- Node.js `crypto` — Built-in HMAC-SHA1 signing (zero extra dependencies)
- [X (Twitter) API v2](https://developer.twitter.com/en/docs/twitter-api) — Tweet creation endpoint
- [Cosmic](https://www.cosmicjs.com) — CMS for content management

## Getting Started

### Prerequisites

- Node.js 18+ or Bun
- X (Twitter) Developer account with OAuth 1.0a credentials
- A secret key for authenticating requests to this microservice

### Installation

```bash
git clone <repo-url>
cd cosmic-tweet-proxy
bun install
```

### Environment Variables

Set the following environment variables (see your hosting platform's secrets manager):

| Variable | Description |
|---|---|
| `X_CONSUMER_KEY` | Twitter app consumer key |
| `X_CONSUMER_SECRET` | Twitter app consumer secret |
| `X_ACCESS_TOKEN` | Twitter OAuth access token |
| `X_ACCESS_TOKEN_SECRET` | Twitter OAuth access token secret |
| `API_SECRET_KEY` | Secret key to authenticate requests to this proxy |

### Running Locally

```bash
bun run dev
```

## API Usage

### POST /api/tweet

```bash
curl -X POST http://localhost:3000/api/tweet \
  -H "Authorization: Bearer your_api_secret_key" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from cosmic-tweet-proxy!"}'
```

**Response (success):**
```json
{
  "success": true,
  "tweet_id": "1234567890",
  "tweet_url": "https://x.com/i/web/status/1234567890"
}
```

**Response (failure):**
```json
{
  "success": false,
  "error": "Unauthorized"
}
```

### GET /api/health

```bash
curl http://localhost:3000/api/health
```

**Response:**
```json
{ "status": "ok" }
```

## Cosmic SDK Examples

```typescript
import { createBucketClient } from '@cosmicjs/sdk'

const cosmic = createBucketClient({
  bucketSlug: process.env.COSMIC_BUCKET_SLUG as string,
  readKey: process.env.COSMIC_READ_KEY as string,
})

// Fetch social posts
const { objects } = await cosmic.objects
  .find({ type: 'social-posts' })
  .props(['title', 'metadata'])
  .depth(1)
```

## Deployment

### Vercel (Recommended)

```bash
bun add -g vercel
vercel --prod
```

Add all environment variables in Vercel Dashboard → Settings → Environment Variables.

### Netlify

```bash
bun add -g netlify-cli
netlify deploy --prod
```

<!-- README_END -->