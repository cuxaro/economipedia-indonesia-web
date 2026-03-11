import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const MOCK_DIR = path.join(ROOT, 'mock');

const PRICING = {
  model: 'gemini-2.5-flash-lite',
  inputPer1M: 0.1,
  outputPer1M: 0.4
};

function approxTokens(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return 0;
  return Math.ceil(cleaned.length / 4);
}

async function main() {
  const entries = await fs.readdir(MOCK_DIR);
  const jsonFiles = entries.filter((file) => file.endsWith('.json'));

  if (!jsonFiles.length) {
    throw new Error('No JSON files found in mock/.');
  }

  let inputTokens = 0;
  let outputTokens = 0;

  for (const fileName of jsonFiles) {
    const raw = await fs.readFile(path.join(MOCK_DIR, fileName), 'utf8');
    const article = JSON.parse(raw);

    const title = String(article.title || '');
    const seo = String(article.seo?.seo_description || '');
    const markdown = String(article.content?.markdown || '');

    const sourceTokens = approxTokens(title) + approxTokens(seo) + approxTokens(markdown);
    const promptOverhead = 220;

    inputTokens += sourceTokens + promptOverhead;
    outputTokens += Math.ceil(sourceTokens * 0.9);
  }

  const inputCost = (inputTokens / 1_000_000) * PRICING.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * PRICING.outputPer1M;
  const total = inputCost + outputCost;

  const projectionFactor = 9000 / jsonFiles.length;

  const projected = {
    inputTokens: Math.round(inputTokens * projectionFactor),
    outputTokens: Math.round(outputTokens * projectionFactor),
    estimatedUSD: Number((total * projectionFactor).toFixed(2))
  };

  console.log(
    JSON.stringify(
      {
        sampleArticles: jsonFiles.length,
        pricing: PRICING,
        sample: {
          inputTokens,
          outputTokens,
          estimatedUSD: Number(total.toFixed(4))
        },
        projectedFor9000: projected
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});