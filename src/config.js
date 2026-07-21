const fs = require('node:fs');

function loadDotEnv(file = '.env') {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

function parseWorkerConfig(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('must be a JSON array');
    return parsed;
  } catch (error) { throw new Error(`Invalid WORKER_CONFIG_JSON: ${error.message}`); }
}

const config = {
  port: Number(process.env.PORT || 3000),
  dataDir: process.env.DATA_DIR || 'data',
  openAiKey: process.env.OPENAI_API_KEY || '',
  openAiModel: process.env.OPENAI_MODEL || 'gpt-5.6',
  workerConfig: parseWorkerConfig(process.env.WORKER_CONFIG_JSON || ''),
  paperSearchEnabled: process.env.PAPER_SEARCH_ENABLED === 'true',
  semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY || '',
  openAlexSearchEnabled: process.env.OPENALEX_SEARCH_ENABLED !== 'false',
};

const provenance = {
  appVersion: '0.1.0',
  promptVersions: { literature: 'literature-v1', hypothesis: 'hypothesis-v1', report: 'report-v1' },
  model: { provider: config.openAiKey ? 'openai' : 'deterministic-demo', name: config.openAiKey ? config.openAiModel : 'offline-fallback' },
};

module.exports = { config, provenance, parseWorkerConfig, loadDotEnv };
