const test = require('node:test');
const assert = require('node:assert/strict');
const { ResearchOrchestrator } = require('../src/orchestrator');
const { Scheduler, defaultWorkers } = require('../src/workers');

function simulatedScheduler() { return new Scheduler(defaultWorkers()); }

test('completes an auditable research loop', async () => {
  let saved;
  const store = { save: async run => { saved = run; }, get: async () => saved };
  const run = await new ResearchOrchestrator({ store, scheduler: simulatedScheduler() }).start({ question: 'Does augmentation improve a small image classifier?', budget: { maxExperiments: 3, maxEpochs: 4 } });
  assert.equal(run.status, 'completed');
  assert.equal(run.results.length, 3);
  assert.equal(run.results.every(result => result.metrics.simulated), true);
  assert.match(run.report, /Metrics are simulated/);
  assert.equal(run.analysis.nextIteration.requiresHumanApproval, true);
  assert.match(run.report, /Proposed next iteration/);
  assert.ok(run.timeline.length >= 8);
  assert.equal(run.benchmark.id, 'cifar10-small-v1');
  assert.equal(run.provenance.promptVersions.literature, 'literature-v1');
});

test('preview creates an inspectable plan without executing or saving it', async () => {
  let saved = false;
  const run = await new ResearchOrchestrator({ store: { save: async () => { saved = true; } } }).preview({
    question: 'Does regularization improve a small image classifier?', budget: { maxExperiments: 2, maxEpochs: 3 },
  });
  assert.equal(run.status, 'planned');
  assert.equal(run.experiments.length, 2);
  assert.equal(run.results, undefined);
  assert.equal(saved, false);
  assert.equal(run.critique.requiresHumanApproval, true);
});

test('preview automatically uses retrieved papers unless a review decision exists', async () => {
  const agents = {
    searchPapers: async () => [{ title: 'Auto paper', authors: [], year: 2024, abstract: 'A useful abstract.' }],
    literature: async (question, papers) => ({ brief: 'Summary', papers, source: 'paper-metadata-and-abstracts' }),
    hypothesis: async question => ({ statement: 'Hypothesis', metric: 'validation_accuracy', profile: 'vision', question }),
    plan: () => [{ id: 'exp-1', benchmark: { id: 'cifar10-small-v1' }, metric: 'validation_accuracy', name: 'baseline' }],
    reviewPlan: () => ({ verdict: 'approved-with-caveats', requiresHumanApproval: true }),
  };
  const run = await new ResearchOrchestrator({ store: { save: async () => {} }, agents }).preview({ question: 'Does augmentation improve a small image classifier?' });
  assert.equal(run.literature.papers[0].title, 'Auto paper');
  assert.equal(run.paperReview.mode, 'automatic-retrieval');
});

test('launch persists queued and completed progress states', async () => {
  const states = [];
  const store = { save: async run => { states.push(run.status); }, get: async () => null };
  const orchestrator = new ResearchOrchestrator({ store, scheduler: simulatedScheduler() });
  const queued = await orchestrator.launch({ question: 'Does augmentation improve a small image classifier?', papersReviewed: true });
  assert.equal(queued.status, 'queued');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.ok(states.includes('running')); assert.ok(states.includes('completed'));
});

test('question-aware profiles choose segmentation experiments', async () => {
  const run = await new ResearchOrchestrator({ store: { save: async () => {} } }).preview({
    question: 'Can attention U-Net improve brain tumor segmentation on BraTS?', budget: { maxExperiments: 3 },
  });
  assert.equal(run.hypothesis.metric, 'dice_score');
  assert.equal(run.hypothesis.profile, 'segmentation');
  assert.deepEqual(run.experiments.map(experiment => experiment.name), ['unet-baseline', 'dice-focal-loss', 'attention-unet']);
});

test('CIFAR-10 plan honors the real worker epoch limit', async () => {
  const run = await new ResearchOrchestrator({ store: { save: async () => {} } }).preview({
    question: 'Does augmentation improve a small image classifier?', budget: { maxEpochs: 20, maxExperiments: 1 }, papersReviewed: true,
  });
  assert.equal(run.experiments[0].epochs, 5);
});

test('DMLF questions create a CPU-compatible DDP experiment plan', async () => {
  const run = await new ResearchOrchestrator({ store: { save: async () => {} } }).preview({
    question: 'Does augmentation improve a DMLF distributed MNIST classifier?', budget: { maxExperiments: 1, maxEpochs: 2 }, papersReviewed: true,
  });
  assert.equal(run.benchmark.id, 'mnist-ddp-v1');
  assert.equal(run.experiments[0].requires, 'cpu');
  assert.equal(run.experiments[0].distributed.backend, 'gloo');
  assert.equal(run.experiments[0].dataset, undefined);
  assert.match(run.benchmark.datasetStatus, /every DMLF node/);
});

test('an explicit benchmark preset selects real DMLF MNIST without keyword wording', async () => {
  const run = await new ResearchOrchestrator({ store: { save: async () => {} } }).preview({
    question: 'Does controlled augmentation improve classifier accuracy?', benchmarkProfile: 'dmlf', budget: { maxExperiments: 1, maxEpochs: 1 }, papersReviewed: true,
  });
  assert.equal(run.benchmarkProfile, 'dmlf');
  assert.equal(run.benchmark.id, 'mnist-ddp-v1');
  assert.equal(run.experiments[0].dataset, undefined);
});

test('repetition planning assigns deterministic distinct seeds and aggregates variance', async () => {
  const agents = new (require('../src/agents').ResearchAgents)();
  const hypothesis = { question: 'DMLF distributed MNIST baseline', profile: 'dmlf', metric: 'validation_accuracy', statement: 'Test hypothesis' };
  const experiments = agents.plan(hypothesis, { maxExperiments: 1, repetitions: 3, seed: 100, nodes: 2, maxEpochs: 1 });
  assert.deepEqual(experiments.map(experiment => experiment.seed), [100, 101, 102]);
  assert.ok(experiments.every(experiment => experiment.groupId === 'candidate-1'));
  const analysis = agents.analyze(experiments.map((experiment, index) => ({ experiment, metrics: { validation_accuracy: [0.7, 0.8, 0.9][index], simulated: false } })));
  assert.equal(analysis.aggregates[0].repetitions, 3);
  assert.ok(Math.abs(analysis.aggregates[0].mean - 0.8) < 1e-12);
  assert.ok(analysis.aggregates[0].standardDeviation > 0);
});

test('offline DMLF questions use explicit synthetic smoke-test data', async () => {
  const run = await new ResearchOrchestrator({ store: { save: async () => {} } }).preview({
    question: 'Does an offline DMLF synthetic classifier execute correctly?', budget: { maxExperiments: 1, maxEpochs: 1 }, papersReviewed: true,
  });
  assert.equal(run.benchmark.id, 'synthetic-ddp-smoke-v1');
  assert.equal(run.experiments[0].dataset, 'synthetic');
});

test('DMLF planning passes a bounded requested node count to the scheduler', async () => {
  const run = await new ResearchOrchestrator({ store: { save: async () => {} } }).preview({
    question: 'Does an offline DMLF synthetic classifier execute correctly?', budget: { maxExperiments: 1, maxEpochs: 1, nodes: 2 }, papersReviewed: true,
  });
  assert.equal(run.experiments[0].distributed.nodes, 2);
});

test('segmentation execution reports its domain metric', async () => {
  const run = await new ResearchOrchestrator({ store: { save: async () => {} }, scheduler: simulatedScheduler() }).start({
    question: 'Can attention U-Net improve brain tumor segmentation on BraTS?', budget: { maxExperiments: 1 },
  });
  assert.equal(run.results[0].metrics.dice_score, 0.78);
  assert.equal(run.results[0].metrics.simulated, true);
});

test('analysis respects a real worker metric instead of assuming validationScore', () => {
  const { ResearchAgents } = require('../src/agents');
  const result = { experiment: { name: 'baseline', metric: 'validation_accuracy', benchmark: { datasetId: 'synthetic' } }, metrics: { validation_accuracy: 0.42, simulated: false } };
  const analysis = new ResearchAgents().analyze([result]);
  assert.match(analysis.recommendation, /validation_accuracy 0.42/);
  assert.doesNotMatch(analysis.limitations.join(' '), /Metrics are simulated/);
  assert.match(analysis.limitations.join(' '), /Synthetic data/);
});

test('run store keeps newest runs first', async () => {
  const { RunStore } = require('../src/store');
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-scientist-'));
  const store = new RunStore(dir);
  await store.save({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' });
  await store.save({ id: 'new', createdAt: '2026-01-02T00:00:00.000Z' });
  assert.deepEqual((await store.list()).map(run => run.id), ['new', 'old']);
  await fs.rm(dir, { recursive: true, force: true });
});

test('worker summary exposes only scheduling metadata', () => {
  const { defaultWorkers } = require('../src/workers');
  assert.deepEqual(defaultWorkers()[0].summary(), { id: 'gpu-lab-01', capabilities: ['cpu', 'gpu'], slots: 2, active: 0, mode: 'simulated' });
});

test('remote worker validates a metric returned by its executor', async () => {
  const { RemoteWorker } = require('../src/workers');
  const worker = new RemoteWorker({ id: 'remote-1', endpoint: 'https://worker.test/execute', capabilities: ['gpu'], token: 'secret', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://worker.test/execute');
    assert.equal(options.headers.Authorization, 'Bearer secret');
    return { ok: true, json: async () => ({ metrics: { dice_score: 0.84, epochs: 4 } }) };
  } });
  const result = await worker.execute({ id: 'exp-1', requires: 'gpu', metric: 'dice_score' });
  assert.equal(result.metrics.dice_score, 0.84);
  assert.equal(result.metrics.simulated, false);
});

test('remote worker accepts a bounded long-running timeout', () => {
  const { RemoteWorker } = require('../src/workers');
  const worker = new RemoteWorker({ id: 'slow', endpoint: 'https://worker.test/execute', capabilities: ['cpu'], timeoutMs: 1_800_000 });
  assert.equal(worker.timeoutMs, 1_800_000);
  assert.throws(() => new RemoteWorker({ id: 'bad', endpoint: 'https://worker.test/execute', capabilities: ['cpu'], timeoutMs: 1 }), /timeoutMs/);
});

test('remote worker identifies an unreachable endpoint', async () => {
  const { RemoteWorker } = require('../src/workers');
  const worker = new RemoteWorker({ id: 'offline', endpoint: 'http://127.0.0.1:8001/execute', capabilities: ['cpu'], fetchImpl: async () => { const error = new TypeError('fetch failed'); error.cause = { code: 'ECONNREFUSED' }; throw error; } });
  await assert.rejects(() => worker.execute({ id: 'exp-1', metric: 'validation_accuracy' }), /offline is unreachable.*ECONNREFUSED/);
});

test('remote worker polls an asynchronous job through completion', async () => {
  const { RemoteWorker } = require('../src/workers');
  let poll = 0; const updates = [];
  const worker = new RemoteWorker({ id: 'async', endpoint: 'http://worker.test/execute', capabilities: ['cpu'], pollIntervalMs: 0, fetchImpl: async (url, options = {}) => {
    if (options.method === 'POST') return { ok: true, json: async () => ({ jobId: 'job-1', statusUrl: '/jobs/job-1' }) };
    poll += 1;
    return { ok: true, json: async () => poll === 1 ? ({ status: 'running', progress: 85 }) : ({ status: 'completed', progress: 100, metrics: { validation_accuracy: 0.8 } }) };
  } });
  const result = await worker.execute({ id: 'exp-1', metric: 'validation_accuracy' }, async update => updates.push(update.progress));
  assert.equal(result.metrics.validation_accuracy, 0.8); assert.deepEqual(updates, [85, 100]);
});

test('trusted worker configuration selects configured worker types', () => {
  const { workersFromConfig } = require('../src/workers');
  const workers = workersFromConfig([{ type: 'simulated', id: 'cpu-demo', capabilities: ['cpu'], slots: 1 }]);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].summary().id, 'cpu-demo');
});

test('DMLF worker configuration retains the bridge asynchronous contract', () => {
  const { workersFromConfig } = require('../src/workers');
  const [worker] = workersFromConfig([{ type: 'dmlf', id: 'cluster', endpoint: 'http://127.0.0.1:8002/execute', capabilities: ['cpu'], slots: 1 }]);
  assert.deepEqual(worker.summary(), { id: 'cluster', capabilities: ['cpu'], slots: 1, active: 0, mode: 'dmlf' });
});

test('runtime DMLF configuration switches the scheduler and exposes planned GPU capability', () => {
  const orchestrator = new ResearchOrchestrator({ store: { save: async () => {} }, scheduler: simulatedScheduler() });
  orchestrator.configureDmlf({ enabled: true, bridgeEndpoint: 'http://127.0.0.1:8002', nodes: [{ resource: 'gpu' }] });
  assert.deepEqual(orchestrator.scheduler.workers[0].summary(), { id: 'dmlf-cluster', capabilities: ['cpu', 'gpu'], slots: 1, active: 0, mode: 'dmlf' });
  orchestrator.configureDmlf({ enabled: false });
  assert.equal(orchestrator.scheduler.workers[0].summary().mode, 'simulated');
});

test('paper source normalizes public paper metadata', async () => {
  const { SemanticScholarSource } = require('../src/paperSources');
  const source = new SemanticScholarSource({ enabled: true, fetchImpl: async url => {
    assert.match(url.toString(), /paper\/search/);
    return { ok: true, json: async () => ({ data: [{ title: 'A paper', year: 2024, authors: [{ name: 'Ada' }], citationCount: 12, url: 'https://example.test/paper', abstract: 'Abstract' }] }) };
  } });
  const papers = await source.search('test query');
  assert.deepEqual(papers[0].authors, ['Ada']);
  assert.equal(papers[0].citationCount, 12);
});

test('paper source exposes retrieval errors to the caller', async () => {
  const { SemanticScholarSource } = require('../src/paperSources');
  const source = new SemanticScholarSource({ enabled: true, fetchImpl: async () => { throw new Error('network unreachable'); } });
  assert.deepEqual(await source.search('test query'), []);
  assert.match(source.status().error, /network unreachable/);
});

test('paper source reports rate limits and caches successful results', async () => {
  const { SemanticScholarSource } = require('../src/paperSources');
  const limited = new SemanticScholarSource({ enabled: true, fetchImpl: async () => ({ ok: false, status: 429, headers: { get: () => '30' }, text: async () => '' }) });
  await limited.search('test query'); assert.match(limited.status().error, /Retry after 30 seconds/);
  let calls = 0;
  const cached = new SemanticScholarSource({ enabled: true, fetchImpl: async () => ({ ok: true, json: async () => { calls += 1; return { data: [{ title: 'Cached' }] }; } }) });
  await cached.search('same query'); await cached.search('same query'); assert.equal(calls, 1);
});

test('fallback paper source uses OpenAlex-style metadata when primary is unavailable', async () => {
  const { FallbackPaperSource, OpenAlexSource } = require('../src/paperSources');
  const unavailable = { enabled: true, search: async () => [], status: () => ({ enabled: true, provider: 'semantic-scholar', error: 'HTTP 429' }) };
  const openAlex = new OpenAlexSource({ fetchImpl: async url => { assert.match(url.toString(), /display_name/); return { ok: true, json: async () => ({ results: [{ id: 'https://openalex.org/W1', display_name: 'Fallback paper', publication_year: 2023, authorships: [{ author: { display_name: 'Grace' } }], cited_by_count: 3 }] }) }; } });
  const source = new FallbackPaperSource([unavailable, openAlex]);
  const papers = await source.search('test');
  assert.equal(papers[0].title, 'Fallback paper'); assert.equal(source.status().provider, 'openalex');
});

test('dotenv loader preserves shell settings and reads local values', () => {
  const { loadDotEnv } = require('../src/config');
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'research-env-')), '.env');
  fs.writeFileSync(file, 'TEST_LOCAL_VALUE=loaded\nTEST_EXISTING_VALUE=file\n');
  process.env.TEST_EXISTING_VALUE = 'shell'; loadDotEnv(file);
  assert.equal(process.env.TEST_LOCAL_VALUE, 'loaded'); assert.equal(process.env.TEST_EXISTING_VALUE, 'shell');
  fs.rmSync(path.dirname(file), { recursive: true, force: true }); delete process.env.TEST_LOCAL_VALUE; delete process.env.TEST_EXISTING_VALUE;
});

test('literature uses only papers approved by the caller', async () => {
  const { ResearchAgents, AgentGateway } = require('../src/agents');
  const agents = new ResearchAgents(new AgentGateway(), { search: async () => { throw new Error('search should not run during reviewed synthesis'); } });
  const literature = await agents.literature('Does augmentation improve a small image classifier?', [{ title: 'Approved paper', authors: [], year: 2024 }]);
  assert.equal(literature.source, 'paper-metadata-and-abstracts');
  assert.deepEqual(literature.papers.map(paper => paper.title), ['Approved paper']);
});

test('report includes approved literature and benchmark provenance', async () => {
  const { ResearchAgents } = require('../src/agents');
  const report = await new ResearchAgents().report({
    id: 'run-1', question: 'Question?', benchmark: { id: 'cifar10-small-v1', datasetId: 'cifar-10', datasetStatus: 'not configured' },
    literature: { papers: [{ title: 'Approved paper', authors: ['Ada'], year: 2024, url: 'https://example.test/paper' }] },
    hypothesis: { statement: 'Hypothesis' }, analysis: { recommendation: 'Repeat.', limitations: ['Simulated.'] }, timeline: [],
  });
  assert.match(report, /Literature citations/); assert.match(report, /Approved paper/); assert.match(report, /cifar10-small-v1/);
});

test('reproducibility manifest records configuration and limitations', () => {
  const { buildManifest } = require('../src/artifacts');
  const manifest = buildManifest({
    id: 'run-1', createdAt: '2026-07-15T00:00:00.000Z', status: 'completed', question: 'Question?', budget: { maxEpochs: 2 },
    literature: { source: 'deterministic-demo', brief: 'brief' }, hypothesis: { statement: 'hypothesis' },
    experiments: [{ id: 'exp-1', name: 'baseline', requires: 'cpu', learningRate: 0.001, augmentation: 'none', epochs: 2 }],
    results: [{ experiment: { id: 'exp-1' }, workerId: 'cpu-1', metrics: { validationScore: 0.7, simulated: true } }], analysis: { recommendation: 'repeat', limitations: [] },
  });
  assert.equal(manifest.schemaVersion, '0.1');
  assert.equal(manifest.executions[0].workerId, 'cpu-1');
  assert.match(manifest.limitations[0], /simulated/);
});
