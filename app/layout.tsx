import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'cosmic-tweet-proxy',
  description: 'Minimal Next.js microservice proxy for X (Twitter) API v2',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="icon"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🐦</text></svg>"
        />
        <script src="/dashboard-console-capture.js" />
      </head>
      <body>{children}</body>
    </html>
  )
}