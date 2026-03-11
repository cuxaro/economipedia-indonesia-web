import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const MOCK_DIR = path.join(ROOT, 'mock');
const OUTPUT_DIR = path.join(ROOT, 'src', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'articles.json');
const CACHE_DIR = path.join(ROOT, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'translations-id.json');

const TRANSLATE_API_URL = process.env.TRANSLATE_API_URL || '';
const TRANSLATE_MODE = process.env.TRANSLATE_MODE || (TRANSLATE_API_URL ? 'api' : 'dictionary');
const TARGET_LOCALE = 'id-ID';

const glossary = new Map([
  ['activos', 'aset'],
  ['activo', 'aset'],
  ['no corrientes', 'tidak lancar'],
  ['mantenidos para la venta', 'dimiliki untuk dijual'],
  ['empresa', 'perusahaan'],
  ['valor razonable', 'nilai wajar'],
  ['contabilidad', 'akuntansi'],
  ['diccionario economico', 'kamus ekonomi'],
  ['ejemplo', 'contoh'],
  ['requisitos', 'persyaratan'],
  ['venta', 'penjualan'],
  ['compradores', 'pembeli'],
  ['precio', 'harga'],
  ['amortizacion', 'penyusutan'],
  ['reclasificacion', 'reklasifikasi'],
  ['futuro', 'masa depan'],
  ['ano', 'tahun'],
  ['anos', 'tahun-tahun'],
  ['enero', 'januari']
]);

function toAsciiLower(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function fixMojibake(input) {
  if (typeof input !== 'string') return input;
  let text = input;
  for (let i = 0; i < 3; i += 1) {
    if (!/[ÃÂâ]/.test(text)) break;
    text = Buffer.from(text, 'latin1').toString('utf8');
  }
  return text
    .replace(/\uFFFD/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
}

function deepFix(value) {
  if (typeof value === 'string') return fixMojibake(value);
  if (Array.isArray(value)) return value.map((entry) => deepFix(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepFix(entry)]));
  }
  return value;
}

function slugify(raw) {
  return toAsciiLower(raw)
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function extractSlugFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const tail = pathname.split('/').filter(Boolean).pop() || '';
    return slugify(tail.replace(/\.html?$/i, ''));
  } catch {
    return '';
  }
}

function translateWithGlossary(text) {
  const source = fixMojibake(text);
  const normalized = toAsciiLower(source);
  let replaced = normalized;
  let hits = 0;

  for (const [from, to] of glossary.entries()) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'g');
    if (regex.test(replaced)) {
      replaced = replaced.replace(regex, to);
      hits += 1;
    }
  }

  const translated = replaced.charAt(0).toUpperCase() + replaced.slice(1);
  return {
    text: translated,
    status: hits > 0 ? 'machine_translated' : 'machine_pending'
  };
}

function getHashKey(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex');
}

function readCacheText(cacheValue) {
  if (typeof cacheValue === 'string') return cacheValue;
  if (cacheValue && typeof cacheValue === 'object' && typeof cacheValue.text === 'string') {
    return cacheValue.text;
  }
  return '';
}

async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

async function translateViaApi(text, cache) {
  const key = getHashKey(text);
  const cached = readCacheText(cache[key]);
  if (cached) {
    return {
      text: cached,
      status: 'machine_translated'
    };
  }

  const response = await fetch(TRANSLATE_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      q: text,
      source: 'es',
      target: 'id',
      format: 'text'
    })
  });

  if (!response.ok) {
    throw new Error(`Translate API failed: ${response.status}`);
  }

  const payload = await response.json();
  const translated = fixMojibake(payload.translatedText || payload.translation || '');
  if (!translated) {
    return {
      text,
      status: 'machine_pending'
    };
  }

  cache[key] = translated;
  return {
    text: translated,
    status: 'machine_translated'
  };
}

async function translateText(text, cache) {
  if (!text) {
    return {
      text: '',
      status: 'machine_pending'
    };
  }

  const key = getHashKey(text);
  const cached = readCacheText(cache[key]);
  if (cached) {
    return {
      text: cached,
      status: 'machine_translated'
    };
  }

  if (TRANSLATE_MODE === 'api' && TRANSLATE_API_URL) {
    try {
      return await translateViaApi(text, cache);
    } catch {
      return translateWithGlossary(text);
    }
  }

  return translateWithGlossary(text);
}

function assertRequired(article, field, value) {
  if (typeof value === 'string' && value.trim()) return;
  throw new Error(`Article ${article.source_slug || article.article_id}: missing ${field}`);
}

async function main() {
  const entries = await fs.readdir(MOCK_DIR);
  const jsonFiles = entries.filter((item) => item.endsWith('.json'));

  if (jsonFiles.length === 0) {
    throw new Error('No JSON files found in mock/.');
  }

  const cache = await loadCache();
  const rawRecords = [];

  for (const file of jsonFiles) {
    const raw = await fs.readFile(path.join(MOCK_DIR, file), 'utf8');
    const parsed = deepFix(JSON.parse(raw));
    rawRecords.push(parsed);
  }

  const seenSlugs = new Set();
  const records = [];

  for (const source of rawRecords) {
    assertRequired(source, 'article_id', source.article_id);
    assertRequired(source, 'source_slug', source.source_slug);
    assertRequired(source, 'title', source.title);
    assertRequired(source, 'published_at', source.published_at);
    assertRequired(source, 'content.markdown', source.content?.markdown);
    assertRequired(source, 'seo.seo_description', source.seo?.seo_description);

    const slug = slugify(source.source_slug);
    if (!slug) {
      throw new Error(`Invalid slug for article ${source.article_id}`);
    }
    if (seenSlugs.has(slug)) {
      throw new Error(`Duplicate slug detected: ${slug}`);
    }
    seenSlugs.add(slug);

    const title = await translateText(source.title, cache);
    const description = await translateText(source.seo.seo_description, cache);
    const markdown = await translateText(source.content.markdown, cache);

    const status = [title.status, description.status, markdown.status].includes('machine_pending')
      ? 'machine_pending'
      : 'machine_translated';

    const internalSlugs = (source.links?.internal || [])
      .map((link) => extractSlugFromUrl(link))
      .filter(Boolean);

    const headings = Array.isArray(source.content?.headings)
      ? source.content.headings.map((item) => ({
          level: Number(item.level || 2),
          text: fixMojibake(item.text || '')
        }))
      : [];

    records.push({
      articleId: source.article_id,
      slug,
      locale: TARGET_LOCALE,
      translationStatus: status,
      title: title.text,
      excerpt: description.text,
      author: fixMojibake(source.author || 'Tim Economipedia'),
      publishedAt: new Date(source.published_at).toISOString(),
      updatedAt: new Date(source.scraped_at || source.published_at).toISOString(),
      segment: fixMojibake(source.segment || 'artikel'),
      sourceUrl: source.source_url,
      links: {
        internalSlugs
      },
      image: source.images?.[0]
        ? {
            src: fixMojibake(source.images[0].src || ''),
            alt: fixMojibake(source.images[0].alt || source.title)
          }
        : null,
      seo: {
        title: title.text,
        description: description.text,
        robots: fixMojibake(source.seo?.robots || 'index,follow'),
        ogTitle: fixMojibake(source.seo?.og_title || title.text),
        ogDescription: fixMojibake(source.seo?.og_description || description.text)
      },
      content: {
        markdown: markdown.text,
        headings,
        wordCount: Number(source.content?.word_count || markdown.text.split(/\s+/).length)
      }
    });
  }

  records.sort((a, b) => a.slug.localeCompare(b.slug));

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(records, null, 2), 'utf8');
  await saveCache(cache);

  console.log(`Content build complete: ${records.length} article(s) generated into src/data/articles.json`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
