class SimulatedWorker {
  constructor({ id, capabilities, slots = 1 }) { this.id = id; this.capabilities = capabilities; this.slots = slots; this.active = 0; }
  canRun(experiment) { return this.active < this.slots && this.capabilities.includes(experiment.requires); }
  summary() { return { id: this.id, capabilities: this.capabilities, slots: this.slots, active: this.active, mode: 'simulated' }; }
  async execute(experiment, onProgress = async () => {}) {
    this.active += 1;
    try {
      await onProgress({ status: 'running', progress: 5 });
      await new Promise(resolve => setTimeout(resolve, 120));
      const score = {
        baseline: 0.71, augmentation: 0.75, 'tuned-learning-rate': 0.77,
        'unet-baseline': 0.78, 'dice-focal-loss': 0.81, 'attention-unet': 0.83,
        'frozen-encoder-baseline': 0.74, 'adapter-fine-tune': 0.78, 'lora-fine-tune': 0.8,
      }[experiment.name] || 0.7;
      return { experiment, workerId: this.id, metrics: { [experiment.metric || 'validation_score']: score, validationScore: score, epochs: experiment.epochs, simulated: true } };
    } finally { this.active -= 1; }
  }
}

class RemoteWorker {
  constructor({ id, endpoint, capabilities, slots = 1, token = '', timeoutMs = 1_800_000, pollIntervalMs = 2_000, fetchImpl = fetch }) {
    if (!id || !endpoint || !Array.isArray(capabilities)) throw new Error('Remote worker requires id, endpoint, and capabilities.');
    if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) throw new Error('Remote worker timeoutMs must be between 10 seconds and 60 minutes.');
    Object.assign(this, { id, endpoint, capabilities, slots, token, timeoutMs, pollIntervalMs, fetchImpl, active: 0 });
  }
  canRun(experiment) { return this.active < this.slots && this.capabilities.includes(experiment.requires); }
  summary() { return { id: this.id, capabilities: this.capabilities, slots: this.slots, active: this.active, mode: 'remote' }; }
  async execute(experiment, onProgress = async () => {}) {
    this.active += 1;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      const response = await this.fetchImpl(this.endpoint, { method: 'POST', headers, body: JSON.stringify({ experiment }), signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Remote worker ${this.id} failed: ${response.status}${detail ? ` — ${detail}` : ''}`);
      }
      const payload = await response.json();
      // Backwards-compatible support for an older synchronous worker response.
      if (payload.metrics) {
        if (!Number.isFinite(payload.metrics?.[experiment.metric])) throw new Error(`Remote worker ${this.id} returned no numeric ${experiment.metric}.`);
        return { experiment, workerId: this.id, metrics: { ...payload.metrics, simulated: false } };
      }
      if (!payload.jobId) throw new Error(`Remote worker ${this.id} returned neither metrics nor jobId.`);
      const jobUrl = new URL(payload.statusUrl || `/jobs/${encodeURIComponent(payload.jobId)}`, this.endpoint).toString();
      const deadline = Date.now() + this.timeoutMs;
      let lastProgress = null;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
        const statusResponse = await this.fetchImpl(jobUrl, { headers, signal: AbortSignal.timeout(Math.min(this.timeoutMs, 30_000)) });
        if (!statusResponse.ok) throw new Error(`Remote worker ${this.id} job ${payload.jobId} status failed: ${statusResponse.status}`);
        const job = await statusResponse.json();
        const progress = job.progress ?? 0;
        const progressKey = `${job.status}:${progress}:${job.warning || job.error || ''}`;
        if (progressKey !== lastProgress) {
          await onProgress({ jobId: payload.jobId, status: job.status, progress, message: job.warning || job.error });
          lastProgress = progressKey;
        }
        if (job.status === 'failed') throw new Error(`Remote worker ${this.id} job ${payload.jobId} failed: ${job.error || 'unknown error'}`);
        if (job.status === 'canceled') throw new Error(`Remote worker ${this.id} job ${payload.jobId} was canceled.`);
        if (job.status === 'completed') {
          if (!Number.isFinite(job.metrics?.[experiment.metric])) throw new Error(`Remote worker ${this.id} job ${payload.jobId} returned no numeric ${experiment.metric}.`);
          return { experiment, workerId: this.id, metrics: { ...job.metrics, simulated: false } };
        }
      }
      throw new Error(`Remote worker ${this.id} job ${payload.jobId} timed out after ${this.timeoutMs}ms.`);
    } catch (error) {
      if (error.message.startsWith(`Remote worker ${this.id}`)) throw error;
      const reason = error.cause?.code || error.cause?.message || error.message;
      throw new Error(`Remote worker ${this.id} is unreachable at ${this.endpoint}: ${reason}`);
    } finally { this.active -= 1; }
  }
}

// DMLF exposes the same asynchronous HTTP contract through its bridge, while
// leaving allocation and DDP launch decisions to the existing DMLF manager.
class DmlfWorker extends RemoteWorker {
  summary() { return { ...super.summary(), mode: 'dmlf' }; }
}

class Scheduler {
  constructor(workers) { this.workers = workers; }
  async execute(experiments, callbacks = {}) {
    const onAssigned = typeof callbacks === 'function' ? callbacks : callbacks.onAssigned || (async () => {});
    const onCompleted = typeof callbacks === 'function' ? async () => {} : callbacks.onCompleted || (async () => {});
    const pending = [...experiments];
    const results = [];
    // One queue per worker keeps GPU-only jobs bounded while independent workers run in parallel.
    await Promise.all([...this.workers].sort((a, b) => a.capabilities.length - b.capabilities.length).map(async worker => {
      while (true) {
        const index = pending.findIndex(experiment => worker.capabilities.includes(experiment.requires));
        if (index < 0) return;
        const [experiment] = pending.splice(index, 1);
        await onAssigned(experiment, worker);
        const result = await worker.execute(experiment, progress => callbacks.onProgress?.(experiment, worker, progress));
        results.push(result);
        await onCompleted(result, worker);
      }
    }));
    if (pending.length) throw new Error(`No compatible worker for ${pending.map(x => x.id).join(', ')}`);
    return results;
  }
}

function defaultWorkers() {
  return [new SimulatedWorker({ id: 'gpu-lab-01', capabilities: ['cpu', 'gpu'], slots: 2 }), new SimulatedWorker({ id: 'cpu-lab-01', capabilities: ['cpu'] })];
}

function workersFromConfig(definitions = []) {
  if (!definitions.length) return defaultWorkers();
  return definitions.map(definition => {
    if (definition.type === 'remote') return new RemoteWorker(definition);
    if (definition.type === 'dmlf') return new DmlfWorker(definition);
    if (definition.type === 'simulated') return new SimulatedWorker(definition);
    throw new Error(`Unsupported worker type: ${definition.type}`);
  });
}

module.exports = { SimulatedWorker, RemoteWorker, DmlfWorker, Scheduler, defaultWorkers, workersFromConfig };
