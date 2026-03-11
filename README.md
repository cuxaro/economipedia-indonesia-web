# ensiklopedia-ekonomi (Astro SSG)

Static SEO-first site for ~9,000 article URLs with Astro + Vercel.

## Features
- Static generation for `/id/:slug/` article URLs.
- Local backup ingestion from `mock/*.json`.
- Mojibake normalization and UTF-8 cleanup.
- Machine translation pipeline ES -> ID (dictionary fallback, optional API).
- Breadcrumb UI + `BreadcrumbList` JSON-LD.
- `Article` JSON-LD, canonical/meta tags, robots, OpenGraph/Twitter.
- Scalable sitemap index + chunked sitemap files.
- CI build checks + Lighthouse sampling + scheduled Vercel deploy.

## Quick Start
```bash
npm install
npm run build
npm run preview
```

## Local Admin Panel
```bash
npm run admin
```

Open `http://127.0.0.1:4311/admin`.

- Paste Gemini API key per session (not persisted).
- Translate selected/pending articles.
- Publish pipeline runs: `content:build` -> `seo:check` -> `build` -> `git push` -> `vercel deploy --prebuilt --prod`.

## Translation Cost Estimate
```bash
npm run translate:cost
```

This prints sample and projected cost for 9,000 articles using Gemini 2.5 Flash-Lite pricing assumptions.

## Content Pipeline
Build reads all files under `mock/*.json` and writes normalized output to `src/data/articles.json`.

Optional machine translation API mode:
```bash
set TRANSLATE_MODE=api
set TRANSLATE_API_URL=https://your-libretranslate-endpoint/translate
npm run content:build
```

Default mode uses built-in glossary translation fallback.

## Required GitHub Secrets for Deploy
- `VERCEL_TOKEN`

## Recommended First Deploy (local)
```bash
vercel link
npm run build
vercel deploy --prebuilt --prod
```
