import type { MetadataRoute } from 'next'

// Private console holding third parties' names and unsent message drafts.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } }
}
