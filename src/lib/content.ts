import { marked } from 'marked';
import articles from '../data/articles.json';

export type NormalizedArticle = {
  articleId: string;
  slug: string;
  locale: 'id-ID';
  translationStatus: 'machine_translated' | 'machine_pending';
  title: string;
  excerpt: string;
  author: string;
  publishedAt: string;
  updatedAt: string;
  segment: string;
  sourceUrl: string;
  links: {
    internalSlugs: string[];
  };
  image: {
    src: string;
    alt: string;
  } | null;
  seo: {
    title: string;
    description: string;
    robots: string;
    ogTitle: string;
    ogDescription: string;
  };
  content: {
    markdown: string;
    headings: Array<{ level: number; text: string }>;
    wordCount: number;
  };
};

const DATA = articles as NormalizedArticle[];

export function getAllArticles(): NormalizedArticle[] {
  return DATA;
}

export function getArticleBySlug(slug: string): NormalizedArticle | undefined {
  return DATA.find((article) => article.slug === slug);
}

export function getCanonical(pathname: string): string {
  const base = (import.meta.env.SITE || 'https://example.com').replace(/\/$/, '');
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${base}${path}`;
}

export function renderArticleHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}

export function getBreadcrumbs(article: NormalizedArticle) {
  return [
    { label: 'Beranda', href: '/' },
    { label: 'Artikel', href: '/id/' },
    { label: article.title, href: `/id/${article.slug}/` }
  ];
}

export function getRelatedArticles(article: NormalizedArticle, limit = 4): NormalizedArticle[] {
  const preferred = DATA.filter((candidate) =>
    article.links.internalSlugs.includes(candidate.slug) && candidate.slug !== article.slug
  );

  if (preferred.length >= limit) {
    return preferred.slice(0, limit);
  }

  const fallback = DATA.filter((candidate) => candidate.slug !== article.slug && !preferred.includes(candidate));
  return [...preferred, ...fallback].slice(0, limit);
}

export function buildArticleSchema(article: NormalizedArticle, canonical: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.seo.description,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: {
      '@type': 'Person',
      name: article.author
    },
    inLanguage: article.locale,
    mainEntityOfPage: canonical,
    image: article.image ? [article.image.src] : undefined
  };
}

export function buildBreadcrumbSchema(
  items: Array<{ label: string; href: string }>
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      item: getCanonical(item.href)
    }))
  };
}

export function getSitemapChunks(chunkSize = 1000): NormalizedArticle[][] {
  const chunks: NormalizedArticle[][] = [];
  for (let i = 0; i < DATA.length; i += chunkSize) {
    chunks.push(DATA.slice(i, i + chunkSize));
  }
  return chunks;
}