import { NextResponse } from 'next/server'

export async function GET() {
  const envCheck = {
    X_CONSUMER_KEY: !!process.env.X_CONSUMER_KEY,
    X_CONSUMER_SECRET: !!process.env.X_CONSUMER_SECRET,
    X_ACCESS_TOKEN: !!process.env.X_ACCESS_TOKEN,
    X_ACCESS_TOKEN_SECRET: !!process.env.X_ACCESS_TOKEN_SECRET,
    PROXY_SECRET_KEY: !!process.env.PROXY_SECRET_KEY,
  }
  const allPresent = Object.values(envCheck).every(Boolean)
  return NextResponse.json({ status: 'ok', env: envCheck, ready: allPresent })
}
