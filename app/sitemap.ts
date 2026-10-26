import type { MetadataRoute } from 'next'

const SITE_URL = 'https://acuity.institute'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      changeFrequency: 'weekly',
      priority: 1
    }
  ]
}
