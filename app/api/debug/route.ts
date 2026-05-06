import { NextResponse } from 'next/server'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Debug endpoint — inspects OAuth 1.0a signing without posting a tweet
// SAFE: only returns first 6 chars of sensitive values, never full secrets
// ---------------------------------------------------------------------------

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

export async function GET() {
  const consumerKey = process.env.X_CONSUMER_KEY ?? ''
  const consumerSecret = process.env.X_CONSUMER_SECRET ?? ''
  const accessToken = process.env.X_ACCESS_TOKEN ?? ''
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET ?? ''

  const envPresent = {
    X_CONSUMER_KEY: !!consumerKey,
    X_CONSUMER_SECRET: !!consumerSecret,
    X_ACCESS_TOKEN: !!accessToken,
    X_ACCESS_TOKEN_SECRET: !!accessTokenSecret,
  }

  const envPrefixes = {
    X_CONSUMER_KEY: consumerKey.slice(0, 6) + '...',
    X_CONSUMER_SECRET: consumerSecret.slice(0, 6) + '...',
    X_ACCESS_TOKEN: accessToken.slice(0, 6) + '...',
    X_ACCESS_TOKEN_SECRET: accessTokenSecret.slice(0, 6) + '...',
  }

  // Build a test signature using a fixed nonce/timestamp for reproducibility
  const testUrl = 'https://api.twitter.com/2/tweets'
  const testNonce = 'debugnonce12345678'
  const testTimestamp = '1700000000'

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: testNonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: testTimestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
  }

  const sortedParams = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join('&')

  const signatureBaseString = [
    'POST',
    percentEncode(testUrl),
    percentEncode(sortedParams),
  ].join('&')

  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessTokenSecret)}`

  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBaseString)
    .digest('base64')

  return NextResponse.json({
    env_present: envPresent,
    env_prefixes: envPrefixes,
    test_signature: {
      nonce: testNonce,
      timestamp: testTimestamp,
      signature_base_string: signatureBaseString,
      signing_key_prefix: signingKey.slice(0, 12) + '...',
      signature,
    },
  })
}
