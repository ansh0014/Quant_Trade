import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'QuantTrade — HFT Orchestration Platform',
  description:
    'Sub-millisecond market data ingestion, lock-free pre-trade risk checks, and real-time walk-forward ML inference for high-frequency trading.',
  keywords: ['HFT', 'trading', 'machine learning', 'polyglot', 'C++', 'Go', 'Python', 'XGBoost'],
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0a0a0a',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="bg-background">
      <body className="antialiased font-sans">{children}</body>
    </html>
  )
}
