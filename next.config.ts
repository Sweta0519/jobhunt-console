import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Private console: keep it out of every index, at the header level too.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }],
      },
    ]
  },
}

export default nextConfig
