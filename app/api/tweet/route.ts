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

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

function buildOAuthHeader(
  method: string,
  url: string,
  bodyParams: Record<string, string> = {}
): string {
  const consumerKey = process.env.X_CONSUMER_KEY ?? ''
  const consumerSecret = process.env.X_CONSUMER_SECRET ?? ''
  const accessToken = process.env.X_ACCESS_TOKEN ?? ''
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET ?? ''

  const oauthNonce = crypto.randomBytes(16).toString('hex')
  const oauthTimestamp = Math.floor(Date.now() / 1000).toString()

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: oauthNonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: oauthTimestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
  }

  // Combine oauth params + body params for signature base string
  const allParams: Record<string, string> = { ...oauthParams, ...bodyParams }
  const sortedParams = Object.keys(allParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k] as string)}`)
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

  const authHeader =
    'OAuth ' +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k] as string)}"`)
      .join(', ')

  // Debug logging (safe — only logs first 6 chars of sensitive values)
  console.log('[oauth] consumer_key prefix:', consumerKey.slice(0, 6))
  console.log('[oauth] access_token prefix:', accessToken.slice(0, 6))
  console.log('[oauth] nonce:', oauthNonce)
  console.log('[oauth] timestamp:', oauthTimestamp)
  console.log('[oauth] signature_base_string:', signatureBaseString)
  console.log('[oauth] signing_key prefix:', signingKey.slice(0, 10) + '...')
  console.log('[oauth] signature:', signature)

  return authHeader
}

// ---------------------------------------------------------------------------
// Post a single tweet using OAuth 1.0a User Context
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

  // OAuth 1.0a does NOT include JSON body params in signature
  const oauthHeader = buildOAuthHeader('POST', twitterUrl, {})

  console.log('[tweet] Posting to Twitter API v2 with OAuth 1.0a')
  console.log('[tweet] Payload:', JSON.stringify(twitterPayload))

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
  const requiredEnvVars = ['X_CONSUMER_KEY', 'X_CONSUMER_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET']
  const missingVars = requiredEnvVars.filter((v) => !process.env[v])
  if (missingVars.length > 0) {
    console.error('[tweet] Missing env vars:', missingVars)
    return NextResponse.json<TweetErrorResponse>(
      { success: false, error: `Server misconfiguration: missing ${missingVars.join(', ')}` },
      { status: 500 }
    )
  }

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
    // THREAD MODE
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

    // SINGLE TWEET MODE
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
