import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchRequestBody {
  query: string
  max_results?: number // 10–100, default 20
  sort_order?: 'recency' | 'relevancy'
}

interface TweetResult {
  id: string
  text: string
  author_id: string
  created_at: string
  url: string
  public_metrics?: {
    retweet_count: number
    reply_count: number
    like_count: number
    quote_count: number
  }
  author?: {
    username: string
    name: string
  }
}

interface SearchSuccessResponse {
  success: true
  query: string
  count: number
  tweets: TweetResult[]
}

interface SearchErrorResponse {
  success: false
  error: string
}

type SearchResponse = SearchSuccessResponse | SearchErrorResponse

// ---------------------------------------------------------------------------
// OAuth 1.0a helpers (same as tweet route)
// ---------------------------------------------------------------------------

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase()
  })
}

function generateNonce(): string {
  return crypto.randomBytes(32).toString('base64').replace(/[^a-zA-Z0-9]/g, '')
}

function buildOAuthHeader(
  method: string,
  url: string,
  queryParams: Record<string, string> = {}
): string {
  const consumerKey = process.env.X_CONSUMER_KEY as string
  const consumerSecret = process.env.X_CONSUMER_SECRET as string
  const accessToken = process.env.X_ACCESS_TOKEN as string
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET as string

  const oauthTimestamp = Math.floor(Date.now() / 1000).toString()
  const oauthNonce = generateNonce()

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: oauthNonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: oauthTimestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
  }

  const allParams: Record<string, string> = {
    ...queryParams,
    ...oauthParams,
  }

  const sortedParams = Object.keys(allParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key] ?? '')}`)
    .join('&')

  const signatureBaseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sortedParams),
  ].join('&')

  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessTokenSecret)}`

  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBaseString)
    .digest('base64')

  oauthParams['oauth_signature'] = signature

  const headerValue =
    'OAuth ' +
    Object.keys(oauthParams)
      .sort()
      .map((key) => `${percentEncode(key)}="${percentEncode(oauthParams[key] ?? '')}"`)
      .join(', ')

  return headerValue
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse<SearchResponse>> {
  // Validate env vars
  const requiredEnvVars = [
    'X_CONSUMER_KEY',
    'X_CONSUMER_SECRET',
    'X_ACCESS_TOKEN',
    'X_ACCESS_TOKEN_SECRET',
  ]
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      return NextResponse.json<SearchErrorResponse>(
        { success: false, error: `Server misconfiguration: ${envVar} not set` },
        { status: 500 }
      )
    }
  }

  let body: SearchRequestBody
  try {
    body = (await request.json()) as SearchRequestBody
  } catch {
    return NextResponse.json<SearchErrorResponse>(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  if (!body.query || body.query.trim() === '') {
    return NextResponse.json<SearchErrorResponse>(
      { success: false, error: 'Missing required field: query' },
      { status: 400 }
    )
  }

  const maxResults = Math.min(Math.max(body.max_results ?? 20, 10), 100)
  const sortOrder = body.sort_order ?? 'recency'

  // Build query params for OAuth signature
  const queryParams: Record<string, string> = {
    query: body.query.trim(),
    max_results: maxResults.toString(),
    sort_order: sortOrder,
    'tweet.fields': 'created_at,public_metrics,author_id',
    expansions: 'author_id',
    'user.fields': 'username,name',
  }

  const baseUrl = 'https://api.twitter.com/2/tweets/search/recent'
  const queryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k] ?? '')}`)
    .join('&')
  const fullUrl = `${baseUrl}?${queryString}`

  const oauthHeader = buildOAuthHeader('GET', baseUrl, queryParams)

  try {
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        Authorization: oauthHeader,
        'Content-Type': 'application/json',
      },
    })

    const data = await response.json() as {
      data?: Array<{
        id: string
        text: string
        author_id: string
        created_at: string
        public_metrics?: {
          retweet_count: number
          reply_count: number
          like_count: number
          quote_count: number
        }
      }>
      includes?: {
        users?: Array<{ id: string; username: string; name: string }>
      }
      errors?: Array<{ message: string }>
      detail?: string
      title?: string
      meta?: { result_count: number }
    }

    if (!response.ok) {
      const errorMessage =
        data.errors?.[0]?.message ??
        data.detail ??
        data.title ??
        `Twitter API error: HTTP ${response.status}`
      console.error('Twitter search error:', errorMessage, data)
      return NextResponse.json<SearchErrorResponse>(
        { success: false, error: errorMessage },
        { status: response.status }
      )
    }

    // Build user lookup map
    const userMap = new Map<string, { username: string; name: string }>()
    if (data.includes?.users) {
      for (const user of data.includes.users) {
        userMap.set(user.id, { username: user.username, name: user.name })
      }
    }

    const tweets: TweetResult[] = (data.data ?? []).map((tweet) => ({
      id: tweet.id,
      text: tweet.text,
      author_id: tweet.author_id,
      created_at: tweet.created_at,
      url: `https://x.com/i/web/status/${tweet.id}`,
      public_metrics: tweet.public_metrics,
      author: userMap.get(tweet.author_id),
    }))

    return NextResponse.json<SearchSuccessResponse>({
      success: true,
      query: body.query.trim(),
      count: tweets.length,
      tweets,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json<SearchErrorResponse>(
      { success: false, error: message },
      { status: 502 }
    )
  }
}
