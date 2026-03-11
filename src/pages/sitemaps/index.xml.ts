import type { APIRoute } from 'astro';
import { getCanonical, getSitemapChunks } from '../../lib/content';

export const GET: APIRoute = () => {
  const chunks = getSitemapChunks(1000);
  const entries = chunks
    .map((_, index) => `<sitemap><loc>${getCanonical(`/sitemaps/articles-${index + 1}.xml`)}</loc></sitemap>`)
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
};