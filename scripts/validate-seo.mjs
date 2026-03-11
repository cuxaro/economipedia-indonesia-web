import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, 'src', 'data', 'articles.json');

function fail(message) {
  console.error(`SEO validation failed: ${message}`);
  process.exit(1);
}

async function main() {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const articles = JSON.parse(raw);

  if (!Array.isArray(articles) || articles.length === 0) {
    fail('No articles found in src/data/articles.json');
  }

  const slugSet = new Set();

  for (const article of articles) {
    if (!article.slug) fail(`Missing slug in article ${article.articleId}`);
    if (slugSet.has(article.slug)) fail(`Duplicate slug: ${article.slug}`);
    slugSet.add(article.slug);

    if (!article.title) fail(`Missing title: ${article.slug}`);
    if (!article.content?.markdown?.trim()) fail(`Empty markdown: ${article.slug}`);
    if (!article.publishedAt) fail(`Missing publishedAt: ${article.slug}`);
    if (!article.seo?.description) fail(`Missing SEO description: ${article.slug}`);
    if (!article.seo?.title) fail(`Missing SEO title: ${article.slug}`);

    const canonicalPath = `/id/${article.slug}/`;
    if (!/^\/id\/[a-z0-9-]+\/$/.test(canonicalPath)) {
      fail(`Invalid canonical path shape: ${canonicalPath}`);
    }
  }

  const chunkCount = Math.ceil(articles.length / 1000);
  if (chunkCount < 1) {
    fail('Sitemap chunk count invalid');
  }

  console.log(`SEO validation OK: ${articles.length} articles, ${chunkCount} sitemap chunk(s)`);
}

main().catch((error) => {
  fail(error.message);
});