import { NextRequest, NextResponse } from 'next/server'

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
// Post a single tweet using OAuth 2.0 user context (Bearer Token)
// ---------------------------------------------------------------------------

async function postSingleTweet(
  text: string,
  mediaIds?: string[],
  replyToTweetId?: string
): Promise<{ tweet_id: string; tweet_url: string }> {
  const twitterUrl = 'https://api.twitter.com/2/tweets'
  const bearerToken = process.env.X_BEARER_TOKEN as string

  const twitterPayload: Record<string, unknown> = {
    text: text.trim(),
  }

  if (mediaIds && mediaIds.length > 0) {
    twitterPayload['media'] = { media_ids: mediaIds }
  }

  if (replyToTweetId) {
    twitterPayload['reply'] = { in_reply_to_tweet_id: replyToTweetId }
  }

  console.log('[tweet] Posting to Twitter API v2 with Bearer Token')
  console.log('[tweet] Env vars present:', {
    X_BEARER_TOKEN: !!process.env.X_BEARER_TOKEN,
    X_ACCESS_TOKEN: !!process.env.X_ACCESS_TOKEN,
  })

  const twitterResponse = await fetch(twitterUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
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
  if (!process.env.X_BEARER_TOKEN) {
    console.error('[tweet] Missing X_BEARER_TOKEN')
    return NextResponse.json<TweetErrorResponse>(
      { success: false, error: 'Server misconfiguration: X_BEARER_TOKEN not set' },
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
