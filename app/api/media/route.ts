import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MediaSuccessResponse {
  success: true
  media_id: string
  media_type: string
  size: number
}

interface MediaErrorResponse {
  success: false
  error: string
}

type MediaResponse = MediaSuccessResponse | MediaErrorResponse

// ---------------------------------------------------------------------------
// OAuth 1.0a helpers (duplicated here — media upload uses v1.1 endpoint)
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
// Chunked media upload via Twitter v1.1 API (INIT / APPEND / FINALIZE)
// ---------------------------------------------------------------------------

const MEDIA_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json'

async function mediaInit(
  totalBytes: number,
  mediaType: string,
  mediaCategory: string
): Promise<string> {
  const params = {
    command: 'INIT',
    total_bytes: totalBytes.toString(),
    media_type: mediaType,
    media_category: mediaCategory,
  }

  const oauthHeader = buildOAuthHeader('POST', MEDIA_UPLOAD_URL, params)

  const form = new URLSearchParams(params)
  const response = await fetch(MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: oauthHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`INIT failed (${response.status}): ${err}`)
  }

  const data = (await response.json()) as { media_id_string: string }
  return data.media_id_string
}

async function mediaAppend(
  mediaId: string,
  chunk: Buffer,
  segmentIndex: number
): Promise<void> {
  const params = {
    command: 'APPEND',
    media_id: mediaId,
    segment_index: segmentIndex.toString(),
  }

  const oauthHeader = buildOAuthHeader('POST', MEDIA_UPLOAD_URL, {})

  const form = new FormData()
  form.append('command', 'APPEND')
  form.append('media_id', mediaId)
  form.append('segment_index', segmentIndex.toString())
  form.append('media', new Blob([chunk]))

  const response = await fetch(MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: oauthHeader,
    },
    body: form,
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`APPEND failed (${response.status}): ${err}`)
  }
}

async function mediaFinalize(mediaId: string): Promise<void> {
  const params = {
    command: 'FINALIZE',
    media_id: mediaId,
  }

  const oauthHeader = buildOAuthHeader('POST', MEDIA_UPLOAD_URL, params)

  const form = new URLSearchParams(params)
  const response = await fetch(MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: oauthHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`FINALIZE failed (${response.status}): ${err}`)
  }

  // For video/gif, poll until processing is complete
  const data = (await response.json()) as {
    processing_info?: { state: string; check_after_secs?: number }
  }

  if (data.processing_info) {
    await pollMediaStatus(mediaId)
  }
}

async function pollMediaStatus(mediaId: string): Promise<void> {
  const maxAttempts = 20
  let attempts = 0

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 3000))

    const params = { command: 'STATUS', media_id: mediaId }
    const oauthHeader = buildOAuthHeader(
      'GET',
      MEDIA_UPLOAD_URL,
      params
    )

    const url = `${MEDIA_UPLOAD_URL}?command=STATUS&media_id=${mediaId}`
    const response = await fetch(url, {
      headers: { Authorization: oauthHeader },
    })

    const data = (await response.json()) as {
      processing_info?: { state: string; error?: { message: string } }
    }

    const state = data.processing_info?.state
    if (state === 'succeeded') return
    if (state === 'failed') {
      throw new Error(
        `Media processing failed: ${data.processing_info?.error?.message ?? 'unknown error'}`
      )
    }

    attempts++
  }

  throw new Error('Media processing timed out after 60 seconds')
}

// ---------------------------------------------------------------------------
// Route handler
// Accept: multipart/form-data with a "file" field
//         OR JSON with { "url": "https://..." } to upload from URL
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse<MediaResponse>> {
  // Validate env vars
  const requiredEnvVars = [
    'X_CONSUMER_KEY',
    'X_CONSUMER_SECRET',
    'X_ACCESS_TOKEN',
    'X_ACCESS_TOKEN_SECRET',
  ]
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      return NextResponse.json<MediaErrorResponse>(
        { success: false, error: `Server misconfiguration: ${envVar} not set` },
        { status: 500 }
      )
    }
  }

  let fileBuffer: Buffer
  let mediaType: string
  let fileName: string

  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    // Direct file upload
    const form = await request.formData()
    const file = form.get('file') as File | null
    if (!file) {
      return NextResponse.json<MediaErrorResponse>(
        { success: false, error: 'Missing file in form data' },
        { status: 400 }
      )
    }
    const arrayBuffer = await file.arrayBuffer()
    fileBuffer = Buffer.from(arrayBuffer)
    mediaType = file.type
    fileName = file.name
  } else {
    // URL-based upload
    let body: { url?: string; media_type?: string } = {}
    try {
      body = (await request.json()) as { url?: string; media_type?: string }
    } catch {
      return NextResponse.json<MediaErrorResponse>(
        { success: false, error: 'Invalid request body' },
        { status: 400 }
      )
    }

    if (!body.url) {
      return NextResponse.json<MediaErrorResponse>(
        { success: false, error: 'Missing required field: url or file' },
        { status: 400 }
      )
    }

    // Fetch the media from URL
    let fetchResponse: Response
    try {
      fetchResponse = await fetch(body.url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'fetch error'
      return NextResponse.json<MediaErrorResponse>(
        { success: false, error: `Failed to fetch media from URL: ${msg}` },
        { status: 400 }
      )
    }

    if (!fetchResponse.ok) {
      return NextResponse.json<MediaErrorResponse>(
        { success: false, error: `URL returned HTTP ${fetchResponse.status}` },
        { status: 400 }
      )
    }

    const arrayBuffer = await fetchResponse.arrayBuffer()
    fileBuffer = Buffer.from(arrayBuffer)
    mediaType = body.media_type ?? fetchResponse.headers.get('content-type') ?? 'application/octet-stream'
    fileName = body.url.split('/').pop() ?? 'media'
  }

  // Determine media category for Twitter
  let mediaCategory = 'tweet_image'
  if (mediaType.startsWith('video/')) {
    mediaCategory = 'tweet_video'
  } else if (mediaType === 'image/gif') {
    mediaCategory = 'tweet_gif'
  }

  // Twitter file size limits
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
  const MAX_VIDEO_SIZE = 512 * 1024 * 1024 // 512MB
  const maxSize = mediaCategory === 'tweet_video' ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE

  if (fileBuffer.length > maxSize) {
    return NextResponse.json<MediaErrorResponse>(
      {
        success: false,
        error: `File too large: ${Math.round(fileBuffer.length / 1024 / 1024)}MB. Max is ${Math.round(maxSize / 1024 / 1024)}MB for ${mediaCategory}`,
      },
      { status: 400 }
    )
  }

  try {
    // INIT
    const mediaId = await mediaInit(fileBuffer.length, mediaType, mediaCategory)

    // APPEND in 5MB chunks
    const CHUNK_SIZE = 5 * 1024 * 1024
    let segmentIndex = 0
    for (let offset = 0; offset < fileBuffer.length; offset += CHUNK_SIZE) {
      const chunk = fileBuffer.slice(offset, offset + CHUNK_SIZE)
      await mediaAppend(mediaId, chunk, segmentIndex++)
    }

    // FINALIZE (polls until processing complete for video)
    await mediaFinalize(mediaId)

    return NextResponse.json<MediaSuccessResponse>({
      success: true,
      media_id: mediaId,
      media_type: mediaType,
      size: fileBuffer.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Media upload error:', message)
    return NextResponse.json<MediaErrorResponse>(
      { success: false, error: message },
      { status: 502 }
    )
  }
}
