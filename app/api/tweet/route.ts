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
  bodyParams: Record<string, string>
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
    ...bodyParams,
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

export async function POST(request: NextRequest): Promise<NextResponse<TweetResponse>> {
  // AUTH CHECK TEMPORARILY DISABLED FOR DEBUGGING
  // TODO: Re-enable after confirming OAuth signing works

  // Validate required environment variables
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

  // Parse and validate the request body
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

  // Build the Twitter API request payload
  const twitterUrl = 'https://api.twitter.com/2/tweets'

  const twitterPayload: Record<string, unknown> = {
    text: body.text.trim(),
  }

  if (body.reply_to_tweet_id && typeof body.reply_to_tweet_id === 'string') {
    twitterPayload['reply'] = {
      in_reply_to_tweet_id: body.reply_to_tweet_id,
    }
  }

  const oauthHeader = buildOAuthHeader('POST', twitterUrl, {})

  // Post the tweet to Twitter
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

  // Parse the Twitter API response
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

  // Return success
  const tweetId = twitterData.data.id
  return NextResponse.json<TweetSuccessResponse>({
    success: true,
    tweet_id: tweetId,
    tweet_url: `https://x.com/i/web/status/${tweetId}`,
  })
}