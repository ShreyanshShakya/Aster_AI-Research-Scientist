function buildManifest(run) {
  return {
    schemaVersion: '0.1',
    runId: run.id,
    createdAt: run.createdAt,
    status: run.status,
    question: run.question,
    budget: run.budget,
    provenance: run.provenance,
    paperReview: run.paperReview,
    benchmark: run.benchmark,
    literature: { source: run.literature.source, brief: run.literature.brief, papers: run.literature.papers || [] },
    hypothesis: run.hypothesis,
    experiments: run.experiments.map(experiment => ({
      id: experiment.id,
      name: experiment.name,
      requirements: experiment.requires,
      configuration: { learningRate: experiment.learningRate, augmentation: experiment.augmentation, epochs: experiment.epochs, seed: experiment.seed, replication: experiment.replication, groupId: experiment.groupId, metric: experiment.metric, profile: experiment.profile, benchmark: experiment.benchmark },
    })),
    executions: run.results.map(result => ({
      experimentId: result.experiment.id,
      workerId: result.workerId,
      metrics: result.metrics,
    })),
    analysis: run.analysis,
    limitations: [
      ...(run.results.every(result => result.metrics.simulated) ? ['This run uses deterministic simulated workers and metrics.'] : ['This run contains real worker execution metrics; inspect worker and dataset provenance before interpreting them.']),
      'No claim should be treated as validated without real, repeated experiments and data provenance.',
    ],
  };
}

module.exports = { buildManifest };
