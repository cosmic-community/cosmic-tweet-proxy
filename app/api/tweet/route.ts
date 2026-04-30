import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TweetRequestBody {
  text: string
  reply_to_tweet_id?: string
}

interface TweetSuccessResponse {
  success: true
  tweet_id: string
  tweet_url: string
}

interface TweetErrorResponse {
  success: false
  error: string
}

type TweetResponse = TweetSuccessResponse | TweetErrorResponse

interface TwitterApiTweetResponse {
  data?: {
    id: string
    text: string
  }
  errors?: Array<{ message: string }>
  detail?: string
  title?: string
}

// ---------------------------------------------------------------------------
// OAuth 1.0a helpers
// ---------------------------------------------------------------------------

/**
 * Percent-encode a string per RFC 3986.
 * Encodes everything except unreserved characters: A-Z a-z 0-9 - _ . ~
 */
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase()
  })
}

/**
 * Generate a random alphanumeric nonce string.
 */
function generateNonce(): string {
  return crypto.randomBytes(32).toString('base64').replace(/[^a-zA-Z0-9]/g, '')
}

/**
 * Build the OAuth Authorization header for a POST request to the Twitter v2
 * tweets endpoint using OAuth 1.0a with HMAC-SHA1.
 */
function buildOAuthHeader(
  method: string,
  url: string,
  bodyParams: Record<string, string>
): string {
  const consumerKey = process.env.X_CONSUMER_KEY as string
  const consumerSecret = process.env.X_CONSUMER_SECRET as string
  const accessToken = process.env.X_ACCESS_TOKEN as string
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET as string

  const oauthTimestamp = Math.floor(Date.now() / 1000).toString()
  const oauthNonce = generateNonce()

  // OAuth parameters (without oauth_signature)
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: oauthNonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: oauthTimestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
  }

  // Collect ALL parameters (OAuth params + body params) for signature base string
  const allParams: Record<string, string> = {
    ...bodyParams,
    ...oauthParams,
  }

  // Sort parameters lexicographically by key and build encoded parameter string
  const sortedParams = Object.keys(allParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key] ?? '')}`)
    .join('&')

  // Build the signature base string
  const signatureBaseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sortedParams),
  ].join('&')

  // Build the signing key
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessTokenSecret)}`

  // Compute HMAC-SHA1 signature
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBaseString)
    .digest('base64')

  oauthParams['oauth_signature'] = signature

  // Build the Authorization header value
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

export async function POST(request: NextRequest): Promise<NextResponse<TweetResponse>> {
  // 1. Authenticate the incoming request
  const authHeader = request.headers.get('authorization') ?? ''
  const expectedToken = process.env.API_SECRET_KEY

  if (!expectedToken) {
    console.error('API_SECRET_KEY environment variable is not set')
    return NextResponse.json<TweetErrorResponse>(
      { success: false, error: 'Server misconfiguration: API_SECRET_KEY not set' },
      { status: 500 }
    )
  }

  if (!authHeader.startsWith('Bearer ') || authHeader.slice(7) !== expectedToken) {
    return NextResponse.json<TweetErrorResponse>(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    )
  }

  // 2. Validate required environment variables
  const requiredEnvVars = [
    'X_CONSUMER_KEY',
    'X_CONSUMER_SECRET',
    'X_ACCESS_TOKEN',
    'X_ACCESS_TOKEN_SECRET',
  ]
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`Missing required environment variable: ${envVar}`)
      return NextResponse.json<TweetErrorResponse>(
        { success: false, error: `Server misconfiguration: ${envVar} not set` },
        { status: 500 }
      )
    }
  }

  // 3. Parse and validate the request body
  let body: TweetRequestBody
  try {
    body = (await request.json()) as TweetRequestBody
  } catch {
    return NextResponse.json<TweetErrorResponse>(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  if (!body.text || typeof body.text !== 'string' || body.text.trim() === '') {
    return NextResponse.json<TweetErrorResponse>(
      { success: false, error: 'Missing required field: text' },
      { status: 400 }
    )
  }

  // 4. Build the Twitter API request payload
  const twitterUrl = 'https://api.twitter.com/2/tweets'

  const twitterPayload: Record<string, unknown> = {
    text: body.text.trim(),
  }

  if (body.reply_to_tweet_id && typeof body.reply_to_tweet_id === 'string') {
    twitterPayload['reply'] = {
      in_reply_to_tweet_id: body.reply_to_tweet_id,
    }
  }

  // 5. For OAuth signing, only include parameters that go in the base string.
  // For Twitter v2 with JSON body, body params are NOT included in OAuth signature.
  // The signature covers only the URL and OAuth params.
  const oauthBodyParams: Record<string, string> = {}

  const oauthHeader = buildOAuthHeader('POST', twitterUrl, oauthBodyParams)

  // 6. Post the tweet to Twitter
  let twitterResponse: Response
  try {
    twitterResponse = await fetch(twitterUrl, {
      method: 'POST',
      headers: {
        Authorization: oauthHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(twitterPayload),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('Failed to reach Twitter API:', message)
    return NextResponse.json<TweetErrorResponse>(
      { success: false, error: `Failed to reach Twitter API: ${message}` },
      { status: 502 }
    )
  }

  // 7. Parse the Twitter API response
  let twitterData: TwitterApiTweetResponse
  try {
    twitterData = (await twitterResponse.json()) as TwitterApiTweetResponse
  } catch {
    return NextResponse.json<TweetErrorResponse>(
      { success: false, error: 'Failed to parse Twitter API response' },
      { status: 502 }
    )
  }

  if (!twitterResponse.ok || !twitterData.data?.id) {
    const errorMessage =
      twitterData.errors?.[0]?.message ??
      twitterData.detail ??
      twitterData.title ??
      `Twitter API error: HTTP ${twitterResponse.status}`

    console.error('Twitter API error:', errorMessage, twitterData)
    return NextResponse.json<TweetErrorResponse>(
      { success: false, error: errorMessage },
      { status: twitterResponse.status >= 400 ? twitterResponse.status : 502 }
    )
  }

  // 8. Return success
  const tweetId = twitterData.data.id
  return NextResponse.json<TweetSuccessResponse>({
    success: true,
    tweet_id: tweetId,
    tweet_url: `https://x.com/i/web/status/${tweetId}`,
  })
}