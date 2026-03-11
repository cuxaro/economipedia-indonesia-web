import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const MOCK_DIR = path.join(ROOT, 'mock');
const CACHE_DIR = path.join(ROOT, '.cache');
const TRANSLATION_CACHE_FILE = path.join(CACHE_DIR, 'translations-id.json');
const ADMIN_STATE_FILE = path.join(CACHE_DIR, 'admin-state.json');
const ADMIN_HTML_FILE = path.join(ROOT, 'scripts', 'admin-panel.html');
const PORT = Number(process.env.ADMIN_PORT || 4311);
const HOST = '127.0.0.1';
const GEMINI_MODEL = 'gemini-2.5-flash-lite';

function hashText(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex');
}

function toAsciiLower(text) {
  return String(text)
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
  if (Array.isArray(value)) return value.map((item) => deepFix(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepFix(entry)]));
  }
  return value;
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function slugFromRecord(record) {
  return toAsciiLower(record.source_slug || '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function readCacheText(cacheValue) {
  if (typeof cacheValue === 'string') return cacheValue;
  if (cacheValue && typeof cacheValue === 'object' && typeof cacheValue.text === 'string') {
    return cacheValue.text;
  }
  return '';
}

function isSpanishDominant(text) {
  const source = ` ${toAsciiLower(text)} `;
  const esWords = [' el ', ' la ', ' los ', ' las ', ' de ', ' que ', ' para ', ' una ', ' por ', ' con '];
  const idWords = [' yang ', ' dan ', ' untuk ', ' dengan ', ' dalam ', ' pada ', ' adalah ', ' atau '];
  const esCount = esWords.reduce((acc, word) => acc + (source.match(new RegExp(word, 'g')) || []).length, 0);
  const idCount = idWords.reduce((acc, word) => acc + (source.match(new RegExp(word, 'g')) || []).length, 0);
  return esCount > 12 && esCount > idCount * 1.8;
}

function stripCodeFence(text) {
  const trimmed = String(text).trim();
  const block = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return block ? block[1].trim() : trimmed;
}

function validateTranslation(sourceMarkdown, result) {
  if (!result || typeof result !== 'object') return 'Invalid JSON translation response.';
  if (!result.title || !result.seo_description || !result.markdown) return 'Missing translated fields.';
  if (String(result.markdown).trim().length < Math.max(120, sourceMarkdown.length * 0.4)) {
    return 'Translated markdown is unexpectedly short.';
  }
  if (isSpanishDominant(result.markdown)) {
    return 'Translation looks mostly Spanish; Indonesian output expected.';
  }
  return '';
}

async function readMockArticles() {
  const entries = await fs.readdir(MOCK_DIR);
  const jsonFiles = entries.filter((name) => name.endsWith('.json')).sort();

  const items = [];
  for (const fileName of jsonFiles) {
    const fullPath = path.join(MOCK_DIR, fileName);
    const raw = await fs.readFile(fullPath, 'utf8');
    const parsed = deepFix(JSON.parse(raw));
    const slug = slugFromRecord(parsed);
    if (!slug) continue;

    items.push({
      fileName,
      fullPath,
      slug,
      articleId: parsed.article_id,
      title: fixMojibake(parsed.title || ''),
      publishedAt: parsed.published_at,
      wordCount: Number(parsed.content?.word_count || String(parsed.content?.markdown || '').split(/\s+/).length),
      source: parsed
    });
  }

  return items;
}

async function getArticlesWithState() {
  const [articles, adminState, translationCache] = await Promise.all([
    readMockArticles(),
    readJson(ADMIN_STATE_FILE, { articles: {} }),
    readJson(TRANSLATION_CACHE_FILE, {})
  ]);

  return articles.map((article) => {
    const state = adminState.articles?.[article.slug] || {};
    const baseHashes = [
      hashText(article.source.title || ''),
      hashText(article.source.seo?.seo_description || ''),
      hashText(article.source.content?.markdown || '')
    ];

    const cacheHits = baseHashes.filter((key) => Boolean(readCacheText(translationCache[key]))).length;
    const inferredStatus = cacheHits === 3 ? 'machine_translated' : 'machine_pending';

    return {
      slug: article.slug,
      articleId: article.articleId,
      title: article.title,
      publishedAt: article.publishedAt,
      wordCount: article.wordCount,
      translationStatus: state.translationStatus || inferredStatus,
      publishedStatus: state.publishedStatus || 'draft',
      lastTranslatedAt: state.lastTranslatedAt || null,
      lastPublishedAt: state.lastPublishedAt || null
    };
  });
}

async function geminiTranslateArticle(apiKey, source) {
  const prompt = [
    'Translate from Spanish (es-ES) to Indonesian (id-ID).',
    'Return only valid JSON with keys: title, seo_description, markdown.',
    'Preserve markdown headings, bullets, and structure.',
    'Use neutral encyclopedia tone focused on economics.',
    'Do not include code fences, explanations, or extra keys.'
  ].join(' ');

  const payload = {
    title: fixMojibake(source.title || ''),
    seo_description: fixMojibake(source.seo?.seo_description || ''),
    markdown: fixMojibake(source.content?.markdown || '')
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.15,
          topP: 0.95,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json'
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: `${prompt}\n\nInput JSON:\n${JSON.stringify(payload)}` }]
          }
        ]
      })
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini HTTP ${response.status}: ${detail.slice(0, 240)}`);
  }

  const raw = await response.json();
  const parts = raw?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((part) => part.text || '').join('');
  if (!text.trim()) {
    throw new Error('Gemini response was empty.');
  }

  const parsed = JSON.parse(stripCodeFence(text));
  const error = validateTranslation(payload.markdown, parsed);
  if (error) {
    throw new Error(error);
  }

  return {
    title: fixMojibake(parsed.title),
    seo_description: fixMojibake(parsed.seo_description),
    markdown: fixMojibake(parsed.markdown)
  };
}

async function translateWithRetries(apiKey, source, retries = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await geminiTranslateArticle(apiKey, source);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
  }
  throw lastError || new Error('Unknown translation error.');
}

function applyTranslationToCache(cache, source, translated) {
  cache[hashText(source.title || '')] = translated.title;
  cache[hashText(source.seo?.seo_description || '')] = translated.seo_description;
  cache[hashText(source.content?.markdown || '')] = translated.markdown;
}

async function translateBatch({ apiKey, slugs }) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Gemini API key is required.');
  }

  const [allArticles, translationCache, adminState] = await Promise.all([
    readMockArticles(),
    readJson(TRANSLATION_CACHE_FILE, {}),
    readJson(ADMIN_STATE_FILE, { articles: {} })
  ]);

  const targets = new Set((Array.isArray(slugs) ? slugs : []).map((slug) => String(slug)));
  const selected = allArticles.filter((article) => targets.has(article.slug));
  if (!selected.length) {
    throw new Error('No matching articles selected for translation.');
  }

  const results = [];
  for (const article of selected) {
    try {
      const translated = await translateWithRetries(apiKey, article.source, 3);
      applyTranslationToCache(translationCache, article.source, translated);
      adminState.articles[article.slug] = {
        ...(adminState.articles[article.slug] || {}),
        translationStatus: 'machine_translated',
        lastTranslatedAt: new Date().toISOString()
      };
      results.push({ slug: article.slug, ok: true });
    } catch (error) {
      adminState.articles[article.slug] = {
        ...(adminState.articles[article.slug] || {}),
        translationStatus: 'machine_pending'
      };
      results.push({ slug: article.slug, ok: false, error: error.message });
    }
  }

  await Promise.all([
    writeJson(TRANSLATION_CACHE_FILE, translationCache),
    writeJson(ADMIN_STATE_FILE, adminState)
  ]);

  const success = results.filter((item) => item.ok).length;
  return { total: results.length, success, failed: results.length - success, results };
}

async function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd: ROOT, shell: true, env: process.env });
    let output = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(output.trim() || `Command failed (${code}): ${command}`));
      }
    });
  });
}

async function publishAll(commitMessage) {
  const state = await readJson(ADMIN_STATE_FILE, { articles: {} });
  const log = [];

  await runCommand('git rev-parse --is-inside-work-tree');
  log.push(await runCommand('npm run content:build'));
  log.push(await runCommand('npm run seo:check'));
  log.push(await runCommand('npm run build'));
  log.push(await runCommand('git add -A'));

  const safeMessage = String(commitMessage || 'chore: admin publish translated content').replace(/"/g, '\\"');
  try {
    log.push(await runCommand(`git commit -m "${safeMessage}"`));
  } catch (error) {
    const message = String(error.message || '');
    if (!/nothing to commit|working tree clean/i.test(message)) {
      throw error;
    }
    log.push('No changes to commit.');
  }

  log.push(await runCommand('git push'));
  log.push(await runCommand('vercel deploy --prebuilt --prod'));

  const now = new Date().toISOString();
  for (const [slug, item] of Object.entries(state.articles || {})) {
    if (item.translationStatus === 'machine_translated') {
      state.articles[slug] = {
        ...item,
        publishedStatus: 'published',
        lastPublishedAt: now
      };
    }
  }

  await writeJson(ADMIN_STATE_FILE, state);
  return { ok: true, log: log.filter(Boolean) };
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || 'GET';
    const url = req.url || '/';

    if (method === 'GET' && (url === '/admin' || url === '/admin/')) {
      const html = await fs.readFile(ADMIN_HTML_FILE, 'utf8');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      });
      res.end(html);
      return;
    }

    if (method === 'GET' && url === '/api/admin/articles') {
      const articles = await getArticlesWithState();
      sendJson(res, 200, { articles });
      return;
    }

    if (method === 'POST' && url === '/api/admin/translate') {
      const body = await readBody(req);
      const result = await translateBatch({ apiKey: body.apiKey, slugs: body.slugs });
      sendJson(res, 200, result);
      return;
    }

    if (method === 'POST' && url === '/api/admin/publish') {
      const body = await readBody(req);
      const result = await publishAll(body.commitMessage);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Internal error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Admin server running at http://${HOST}:${PORT}/admin`);
});