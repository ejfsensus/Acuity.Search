import type { MetadataRoute } from 'next'

const SITE_URL = 'https://acuity.institute'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/auth/', '/relay/', '/share/']
      }
    ],
    sitemap: `${SITE_URL}/sitemap.xml`
  }
}
