import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, 'src', 'data', 'articles.json');
const OUTPUT_FILE = path.join(ROOT, '.lighthouserc.auto.json');

function sample(items, maxItems) {
  if (items.length <= maxItems) return items;
  const step = Math.max(1, Math.floor(items.length / maxItems));
  const picked = [];
  for (let i = 0; i < items.length && picked.length < maxItems; i += step) {
    picked.push(items[i]);
  }
  return picked;
}

async function main() {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const articles = JSON.parse(raw);

  const paths = ['/'];
  const sampled = sample(articles, 10).map((article) => `/id/${article.slug}/`);
  paths.push(...sampled);

  const config = {
    ci: {
      collect: {
        staticDistDir: './dist',
        numberOfRuns: 1,
        url: paths
      },
      assert: {
        assertions: {
          'categories:performance': ['error', { minScore: 0.9 }],
          'categories:seo': ['error', { minScore: 0.95 }],
          'categories:best-practices': ['error', { minScore: 0.85 }],
          'categories:accessibility': ['error', { minScore: 0.9 }]
        }
      },
      upload: {
        target: 'filesystem',
        outputDir: '.lighthouseci'
      }
    }
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(config, null, 2), 'utf8');
  console.log(`LHCI config generated with ${paths.length} URL(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
