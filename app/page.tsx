import { NextResponse } from 'next/server'

export default function HomePage() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: '640px',
        margin: '80px auto',
        padding: '0 24px',
        color: '#11171A',
      }}
    >
      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px' }}>
        🐦 cosmic-tweet-proxy
      </h1>
      <p style={{ color: '#6b7280', marginBottom: '32px', fontSize: '16px' }}>
        Minimal X (Twitter) API v2 proxy microservice with OAuth 1.0a signing.
      </p>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>
          Endpoints
        </h2>
        <div
          style={{
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '16px',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                background: '#16a34a',
                color: 'white',
                fontSize: '12px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '4px',
              }}
            >
              POST
            </span>
            <code style={{ fontSize: '14px', fontFamily: 'monospace' }}>
              /api/tweet
            </code>
            <span style={{ color: '#6b7280', fontSize: '14px' }}>
              — Post a tweet
            </span>
          </div>
          <div
            style={{
              padding: '16px',
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                background: '#2563eb',
                color: 'white',
                fontSize: '12px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '4px',
              }}
            >
              GET
            </span>
            <code style={{ fontSize: '14px', fontFamily: 'monospace' }}>
              /api/health
            </code>
            <span style={{ color: '#6b7280', fontSize: '14px' }}>
              — Health check
            </span>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>
          Usage
        </h2>
        <pre
          style={{
            background: '#11171A',
            color: '#e5e7eb',
            borderRadius: '8px',
            padding: '16px',
            fontSize: '13px',
            overflowX: 'auto',
            lineHeight: '1.6',
          }}
        >
          {`curl -X POST /api/tweet \\
  -H "Authorization: Bearer <API_SECRET_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Hello from cosmic-tweet-proxy!"}'`}
        </pre>
      </section>

      <section>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>
          Response
        </h2>
        <pre
          style={{
            background: '#11171A',
            color: '#e5e7eb',
            borderRadius: '8px',
            padding: '16px',
            fontSize: '13px',
            overflowX: 'auto',
            lineHeight: '1.6',
          }}
        >
          {`{
  "success": true,
  "tweet_id": "1234567890",
  "tweet_url": "https://x.com/i/web/status/1234567890"
}`}
        </pre>
      </section>
    </main>
  )
}