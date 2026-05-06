import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TweetPayload {
  text: string
  media_ids?: string[]
  reply_to_tweet_id?: string
}

interface TweetRequestBody {
  text?: string
  media_ids?: string[]
  reply_to_tweet_id?: string
  // Thread support: array of tweet payloads. First item is the root tweet.
  thread?: TweetPayload[]
}

interface TweetSuccessResponse {
  success: true
  tweet_id: string
  tweet_url: string
  thread?: Array<{ tweet_id: string; tweet_url: string }>
}

interface TweetErrorResponse {
  success: false
  error: string
  twitter_raw?: unknown
}

type TweetResponse = TweetSuccessResponse | TweetErrorResponse

interface TwitterApiTweetResponse {
  data?: {
    id: string
    text: string
  }
  errors?: Array<{ message: string; code?: number }>
  detail?: string
  title?: string
  status?: number
  type?: string
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
  bodyParams: Record<string, string> = {}
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
// Post a single tweet (internal helper)
// ---------------------------------------------------------------------------

async function postSingleTweet(
  text: string,
  mediaIds?: string[],
  replyToTweetId?: string
): Promise<{ tweet_id: string; tweet_url: string }> {
  const twitterUrl = 'https://api.twitter.com/2/tweets'

  const twitterPayload: Record<string, unknown> = {
    text: text.trim(),
  }

  if (mediaIds && mediaIds.length > 0) {
    twitterPayload['media'] = { media_ids: mediaIds }
  }

  if (replyToTweetId) {
    twitterPayload['reply'] = { in_reply_to_tweet_id: replyToTweetId }
  }

  const oauthHeader = buildOAuthHeader('POST', twitterUrl, {})

  console.log('[tweet] Posting to Twitter API')
  console.log('[tweet] Env vars present:', {
    X_CONSUMER_KEY: !!process.env.X_CONSUMER_KEY,
    X_CONSUMER_SECRET: !!process.env.X_CONSUMER_SECRET,
    X_ACCESS_TOKEN: !!process.env.X_ACCESS_TOKEN,
    X_ACCESS_TOKEN_SECRET: !!process.env.X_ACCESS_TOKEN_SECRET,
  })

  const twitterResponse = await fetch(twitterUrl, {
    method: 'POST',
    headers: {
      Authorization: oauthHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(twitterPayload),
  })

  const twitterData = (await twitterResponse.json()) as TwitterApiTweetResponse

  console.log('[tweet] Twitter API status:', twitterResponse.status)
  console.log('[tweet] Twitter API response:', JSON.stringify(twitterData))

  if (!twitterResponse.ok || !twitterData.data?.id) {
    const errorMessage =
      twitterData.errors?.[0]?.message ??
      twitterData.detail ??
      twitterData.title ??
      `Twitter API error: HTTP ${twitterResponse.status}`
    console.error('[tweet] Twitter API error:', errorMessage, JSON.stringify(twitterData))
    const err = new Error(errorMessage) as Error & { twitter_raw?: unknown }
    err.twitter_raw = twitterData
    throw err
  }

  const tweetId = twitterData.data.id
  return {
    tweet_id: tweetId,
    tweet_url: `https://x.com/i/web/status/${tweetId}`,
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse<TweetResponse>> {
  // Validate required environment variables
  const requiredEnvVars = [
    'X_CONSUMER_KEY',
    'X_CONSUMER_SECRET',
    'X_ACCESS_TOKEN',
    'X_ACCESS_TOKEN_SECRET',
  ]
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`[tweet] Missing required environment variable: ${envVar}`)
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

  try {
    // -----------------------------------------------------------------------
    // THREAD MODE: array of tweets posted sequentially, each replying to prev
    // -----------------------------------------------------------------------
    if (body.thread && Array.isArray(body.thread) && body.thread.length > 0) {
      if (body.thread.length > 25) {
        return NextResponse.json<TweetErrorResponse>(
          { success: false, error: 'Thread too long: maximum 25 tweets per thread' },
          { status: 400 }
        )
      }

      const threadResults: Array<{ tweet_id: string; tweet_url: string }> = []
      let previousTweetId: string | undefined = undefined

      for (const tweet of body.thread) {
        if (!tweet.text || tweet.text.trim() === '') {
          return NextResponse.json<TweetErrorResponse>(
            { success: false, error: 'Each thread tweet must have non-empty text' },
            { status: 400 }
          )
        }

        const result = await postSingleTweet(
          tweet.text,
          tweet.media_ids,
          previousTweetId
        )
        threadResults.push(result)
        previousTweetId = result.tweet_id

        // Small delay between thread tweets to avoid rate limiting
        if (body.thread.indexOf(tweet) < body.thread.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }

      return NextResponse.json<TweetSuccessResponse>({
        success: true,
        tweet_id: threadResults[0]!.tweet_id,
        tweet_url: threadResults[0]!.tweet_url,
        thread: threadResults,
      })
    }

    // -----------------------------------------------------------------------
    // SINGLE TWEET MODE
    // -----------------------------------------------------------------------
    if (!body.text || typeof body.text !== 'string' || body.text.trim() === '') {
      return NextResponse.json<TweetErrorResponse>(
        { success: false, error: 'Missing required field: text (or provide a thread array)' },
        { status: 400 }
      )
    }

    const result = await postSingleTweet(
      body.text,
      body.media_ids,
      body.reply_to_tweet_id
    )

    return NextResponse.json<TweetSuccessResponse>({
      success: true,
      ...result,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const raw = (err as Error & { twitter_raw?: unknown }).twitter_raw
    return NextResponse.json<TweetErrorResponse>(
      { success: false, error: message, twitter_raw: raw },
      { status: 502 }
    )
  }
}
