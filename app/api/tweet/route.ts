import { NextRequest, NextResponse } from 'next/server'
import { TwitterApi } from 'twitter-api-v2'

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

// ---------------------------------------------------------------------------
// Get Twitter client (OAuth 1.0a User Context via twitter-api-v2)
// ---------------------------------------------------------------------------

function getTwitterClient(): TwitterApi {
  const appKey = process.env.X_CONSUMER_KEY ?? ''
  const appSecret = process.env.X_CONSUMER_SECRET ?? ''
  const accessToken = process.env.X_ACCESS_TOKEN ?? ''
  const accessSecret = process.env.X_ACCESS_TOKEN_SECRET ?? ''

  console.log('[twitter] consumer_key prefix:', appKey.slice(0, 6))
  console.log('[twitter] access_token prefix:', accessToken.slice(0, 6))

  return new TwitterApi({
    appKey,
    appSecret,
    accessToken,
    accessSecret,
  })
}

// ---------------------------------------------------------------------------
// Post a single tweet
// ---------------------------------------------------------------------------

async function postSingleTweet(
  client: TwitterApi,
  text: string,
  mediaIds?: string[],
  replyToTweetId?: string
): Promise<{ tweet_id: string; tweet_url: string }> {
  const payload: Parameters<typeof client.v2.tweet>[0] = { text: text.trim() }

  if (mediaIds && mediaIds.length > 0) {
    // twitter-api-v2 expects a specific tuple type for media_ids
    payload.media = { media_ids: mediaIds as unknown as [string] }
  }

  if (replyToTweetId) {
    payload.reply = { in_reply_to_tweet_id: replyToTweetId }
  }

  console.log('[tweet] Posting tweet:', JSON.stringify(payload))

  const response = await client.v2.tweet(payload)

  console.log('[tweet] Response:', JSON.stringify(response))

  const tweetId = response.data.id
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
    const client = getTwitterClient()

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

        const result = await postSingleTweet(client, tweet.text, tweet.media_ids, previousTweetId)
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

    const result = await postSingleTweet(client, body.text, body.media_ids, body.reply_to_tweet_id)

    return NextResponse.json<TweetSuccessResponse>({
      success: true,
      ...result,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const raw = (err as { data?: unknown }).data ?? err
    console.error('[tweet] Error:', message, JSON.stringify(raw))
    return NextResponse.json<TweetErrorResponse>(
      { success: false, error: message, twitter_raw: raw },
      { status: 502 }
    )
  }
}
