import type { APIRoute } from 'astro';
import { getCanonical, getSitemapChunks } from '../../lib/content';

export function getStaticPaths() {
  const chunks = getSitemapChunks(1000);
  return chunks.map((_, index) => ({
    params: { page: String(index + 1) },
    props: { pageIndex: index }
  }));
}

export const GET: APIRoute = ({ props }) => {
  const chunks = getSitemapChunks(1000);
  const pageIndex = Number(props.pageIndex);
  const selected = chunks[pageIndex] || [];

  const urls = selected
    .map(
      (article) =>
        `<url><loc>${getCanonical(`/id/${article.slug}/`)}</loc><lastmod>${new Date(article.updatedAt).toISOString()}</lastmod></url>`
    )
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
};