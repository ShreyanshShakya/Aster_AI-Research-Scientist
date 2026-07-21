const { randomUUID } = require('node:crypto');
const { ResearchAgents } = require('./agents');
const { Scheduler, workersFromConfig, defaultWorkers, DmlfWorker } = require('./workers');
const { config, provenance } = require('./config');

class ResearchOrchestrator {
  constructor({ store, agents = new ResearchAgents(), scheduler = new Scheduler(workersFromConfig(config.workerConfig)) }) { Object.assign(this, { store, agents, scheduler }); }
  configureDmlf(dmlf) {
    if (!dmlf?.enabled) { this.scheduler = new Scheduler(defaultWorkers()); return; }
    const capabilities = ['cpu'];
    if (dmlf.nodes?.some(node => node.resource === 'gpu')) capabilities.push('gpu');
    this.scheduler = new Scheduler([new DmlfWorker({ id: 'dmlf-cluster', endpoint: `${dmlf.bridgeEndpoint}/execute`, capabilities, slots: 1, timeoutMs: 1_800_000 })]);
  }
  async preview({ question, budget = {}, approvedPapers = [], papersReviewed = false, dmlf = null, benchmarkProfile = '' }) {
    if (!question || question.length < 10) throw new Error('Provide a focused research question of at least 10 characters.');
    let papers = approvedPapers;
    let reviewMode = papersReviewed ? 'manual-review' : 'automatic-retrieval';
    if (!papersReviewed && !papers.length) papers = await this.agents.searchPapers(question);
    const run = { id: randomUUID(), question, budget, benchmarkProfile: benchmarkProfile || 'auto', status: 'planned', timeline: [], createdAt: new Date().toISOString(), provenance, execution: dmlf?.enabled ? { mode: 'dmlf', bridgeEndpoint: dmlf.bridgeEndpoint, managerAddress: dmlf.managerAddress, requestedNodes: dmlf.requestedNodes, plannedNodes: dmlf.nodes } : { mode: 'standard' }, paperReview: { completed: papersReviewed, mode: reviewMode, approvedCount: approvedPapers.length, retrievedCount: papers.length } };
    const log = event => run.timeline.push({ at: new Date().toISOString(), event });
    log('Run created');
    run.literature = await this.agents.literature(question, papers, benchmarkProfile); log(`Literature brief completed (${run.literature.source})`);
    run.hypothesis = await this.agents.hypothesis(question, run.literature, benchmarkProfile); log('Falsifiable hypothesis created');
    run.experiments = this.agents.plan(run.hypothesis, budget); run.benchmark = run.experiments[0].benchmark; log(`${run.experiments.length} bounded experiments planned for ${run.benchmark.id}`);
    run.critique = this.agents.reviewPlan(question, run.literature, run.hypothesis, run.experiments); log(`Plan critic: ${run.critique.verdict}`);
    return run;
  }
  async executePrepared(run) {
    run.status = 'running';
    const log = event => run.timeline.push({ at: new Date().toISOString(), event });
    await this.store.save(run);
    const persistEvent = async event => { log(event); await this.store.save(run); };
    run.results = await this.scheduler.execute(run.experiments, {
      onAssigned: async (experiment, worker) => persistEvent(`${experiment.id} assigned to ${worker.id}`),
      onProgress: async (experiment, worker, progress) => persistEvent(`${experiment.id} on ${worker.id}: ${progress.status}${Number.isFinite(progress.progress) ? ` (${progress.progress}%)` : ''}${progress.message ? ` — ${progress.message}` : ''}`),
      onCompleted: async result => persistEvent(`${result.experiment.id} completed on ${result.workerId}`),
    }); await persistEvent('All worker results collected');
    run.analysis = this.agents.analyze(run.results); log('Results analyzed');
    run.report = await this.agents.report(run); log('Report generated');
    run.status = 'completed'; await this.store.save(run); return run;
  }
  async start(input) { return this.executePrepared(await this.preview(input)); }
  async launch(input) {
    const run = await this.preview(input);
    run.status = 'queued'; await this.store.save(run);
    setImmediate(async () => {
      try { await this.executePrepared(run); }
      catch (error) { run.status = 'failed'; run.error = error.message; run.timeline.push({ at: new Date().toISOString(), event: `Run failed: ${error.message}` }); await this.store.save(run); }
    });
    return run;
  }
}
module.exports = { ResearchOrchestrator };
