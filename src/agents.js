const { config, provenance } = require('./config');
const { profileFor } = require('./profiles');
const { SemanticScholarSource, OpenAlexSource, FallbackPaperSource } = require('./paperSources');

class AgentGateway {
  async synthesize({ role, prompt, fallback }) {
    if (!config.openAiKey) return fallback();
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openAiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.openAiModel, input: `${role}\n\n${prompt}`, max_output_tokens: 700 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`);
    const data = await response.json();
    return data.output_text || fallback();
  }
}

class ResearchAgents {
  constructor(gateway = new AgentGateway(), paperSource = new FallbackPaperSource([
    new SemanticScholarSource({ enabled: config.paperSearchEnabled, apiKey: config.semanticScholarApiKey }),
    new OpenAlexSource({ enabled: config.paperSearchEnabled && config.openAlexSearchEnabled }),
  ])) { Object.assign(this, { gateway, paperSource }); }

  async searchPapers(question) { return this.paperSource.search(question); }

  summarizeAbstracts(papers) {
    const evidence = papers.filter(paper => paper.abstract).slice(0, 3).map(paper => {
      const sentence = paper.abstract.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)[0] || paper.abstract;
      return `- ${paper.title}: ${sentence}`;
    });
    return evidence.length ? evidence.join('\n') : 'No approved or retrieved abstracts were available; the brief is based on benchmark-profile guidance and paper metadata only.';
  }

  async literature(question, papers = [], requestedProfile = '') {
    const profile = profileFor(question, requestedProfile);
    const paperContext = papers.length ? `Retrieved metadata: ${papers.map(paper => `${paper.title} (${paper.year || 'n.d.'})`).join('; ')}.` : 'No live papers were retrieved.';
    const abstractSummary = this.summarizeAbstracts(papers);
    const fallback = () => `Scope: ${question}. ${profile.literatureThemes}\n\nEvidence from retrieved abstracts:\n${abstractSummary}\n\n${paperContext} Treat this as a preliminary literature brief; validate claims against primary papers before a real study.`;
    return { brief: await this.gateway.synthesize({ role: 'You are a cautious ML literature analyst.', prompt: `Create a compact research brief for: ${question}. ${paperContext}\nAbstract evidence:\n${abstractSummary}\nState uncertainty and do not invent citations.`, fallback }), source: papers.length ? 'paper-metadata-and-abstracts' : (config.openAiKey ? 'openai' : 'deterministic-demo'), papers, abstractSummary, promptVersion: provenance.promptVersions.literature };
  }

  async hypothesis(question, literature, requestedProfile = '') {
    const profile = profileFor(question, requestedProfile);
    const fallback = () => `For ${question}, a controlled intervention will improve ${profile.metric} over the baseline by at least ${profile.threshold} while staying within the stated budget.`;
    return { statement: await this.gateway.synthesize({ role: 'You formulate falsifiable ML hypotheses.', prompt: `Question: ${question}\nBrief: ${literature.brief}\nReturn one falsifiable hypothesis with a measurable success threshold.`, fallback }), metric: profile.metric, threshold: profile.threshold, profile: profile.id, question, promptVersion: provenance.promptVersions.hypothesis };
  }

  plan(hypothesis, budget) {
    const max = Math.max(1, Math.min(Number(budget.maxExperiments || 3), 6));
    const profile = profileFor(hypothesis.question, hypothesis.profile);
    const candidates = profile.experiments.slice(0, max);
    const benchmark = profile.benchmark;
    const maxEpochs = Math.max(1, Math.min(Number(budget.maxEpochs || 8), benchmark.executionLimits?.maxEpochs || 30, 30));
    const requestedNodes = Math.max(1, Math.min(Number(budget.nodes || 1), 16));
    const repetitions = Math.max(1, Math.min(Number(budget.repetitions || 1), 5));
    const baseSeed = Math.max(0, Math.min(Number(budget.seed || 42), 2_147_483_000));
    return candidates.flatMap((item, index) => Array.from({ length: repetitions }, (_, repeatIndex) => ({
      id: `exp-${index + 1}-r${repeatIndex + 1}`,
      groupId: `candidate-${index + 1}`,
      replication: repeatIndex + 1,
      seed: baseSeed + repeatIndex,
      ...item,
      ...(item.distributed ? { distributed: { ...item.distributed, nodes: requestedNodes } } : {}),
      metric: hypothesis.metric, profile: hypothesis.profile, benchmark, epochs: maxEpochs, hypothesis: hypothesis.statement,
    })));
  }

  reviewPlan(question, literature, hypothesis, experiments) {
    const hasBaseline = experiments.some(experiment => experiment.name.includes('baseline'));
    const hasMetric = experiments.every(experiment => experiment.metric === hypothesis.metric);
    const warnings = [];
    if (!literature.papers.length) warnings.push('No retrieved paper metadata was available; validate the rationale against primary sources.');
    if (!hasBaseline) warnings.push('No explicit baseline is present for comparison.');
    if (!hasMetric) warnings.push('Experiment metrics do not match the hypothesis metric.');
    return {
      verdict: hasBaseline && hasMetric ? 'approved-with-caveats' : 'revision-required',
      rationale: `The plan tests ${hypothesis.metric} for the focused question: ${question}`,
      requiredControls: ['Use a fixed data split and seed policy.', 'Compare against the baseline under the same epoch and preprocessing budget.', 'Report variance across repeated runs before accepting an improvement.'],
      warnings,
      requiresHumanApproval: true,
    };
  }

  analyze(results) {
    const metricValue = result => result.metrics[result.experiment.metric] ?? result.metrics.validationScore;
    const ranked = [...results].sort((a, b) => metricValue(b) - metricValue(a));
    const best = ranked[0];
    const metric = best.experiment.metric || 'validationScore';
    const score = metricValue(best);
    const allSimulated = results.every(result => result.metrics.simulated);
    const aggregates = [...results.reduce((groups, result) => {
      const key = result.experiment.groupId || result.experiment.id;
      const group = groups.get(key) || { groupId: key, name: result.experiment.name, metric: result.experiment.metric, results: [] };
      group.results.push(result); groups.set(key, group); return groups;
    }, new Map()).values()].map(group => {
      const values = group.results.map(metricValue);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const standardDeviation = values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)) : null;
      return { ...group, mean, standardDeviation, repetitions: values.length };
    }).sort((a, b) => b.mean - a.mean);
    const bestAggregate = aggregates[0];
    const isRepeated = bestAggregate.repetitions > 1;
    return {
      ranked,
      aggregates,
      recommendation: isRepeated
        ? `Best repeated result: ${bestAggregate.name} (${bestAggregate.metric} mean ${bestAggregate.mean.toFixed(4)}${bestAggregate.standardDeviation !== null ? ` ± ${bestAggregate.standardDeviation.toFixed(4)}` : ''}, n=${bestAggregate.repetitions}).`
        : `Promote ${best.experiment.name} (${metric} ${score}) to a repeated run before accepting the finding.`,
      nextIteration: {
        title: `Validate ${best.experiment.name} with repeated seeds`,
        rationale: 'The current ranking is a single-run result and may reflect run-to-run variation rather than a reliable improvement.',
        proposedBudget: { repetitions: 3, comparison: 'best candidate versus baseline', stoppingRule: 'Do not promote a result without mean/variance and a held-out evaluation.' },
        requiresHumanApproval: true,
      },
      limitations: [
        allSimulated ? 'Metrics are simulated.' : (isRepeated ? 'Metrics come from real repeated execution; inspect variance and data provenance before interpreting the result.' : 'Metrics come from a real execution, but one run is not sufficient scientific evidence.'),
        best.experiment.benchmark?.datasetId === 'synthetic' ? 'Synthetic data was used for execution validation; this is not benchmark evidence.' : (isRepeated ? 'No held-out external dataset was used.' : 'No variance estimate or held-out external dataset was used.'),
      ],
    };
  }

  async report(run) {
    const reviewedPapers = run.literature.papers?.length
      ? run.literature.papers.map(paper => `- ${paper.authors?.join(', ') || 'Unknown author'} (${paper.year || 'n.d.'}). ${paper.url ? `[${paper.title}](${paper.url})` : paper.title}.`).join('\n')
      : '- No external paper metadata was approved for this run.';
    const nextIteration = run.analysis.nextIteration || { title: 'No follow-up proposal recorded.', rationale: 'This run was created before iterative proposals were added.', proposedBudget: {}, requiresHumanApproval: true };
    const critique = run.critique || { verdict: 'not recorded', rationale: 'This run was created before plan criticism was added.', requiredControls: [] };
    const experimentTable = (run.results || []).map(result => `| ${result.experiment.name} | ${result.workerId} | ${result.metrics[result.experiment.metric] ?? result.metrics.validationScore} | ${result.metrics.simulated ? 'simulated' : 'real'} |`).join('\n') || '| No execution record | — | — | — |';
    const fallback = () => `# Research run: ${run.id}\n\n## Question\n${run.question}\n\n## Benchmark\n${run.benchmark.id} — ${run.benchmark.datasetId} (${run.benchmark.datasetStatus})\n\n## Literature citations\n${reviewedPapers}\n\n## Literature synthesis\n${run.literature.brief || 'No synthesis recorded.'}\n\n## Hypothesis\n${run.hypothesis.statement}\n\n## Plan critic\nVerdict: ${critique.verdict}\n\n${critique.rationale}\n\nControls:\n${critique.requiredControls.map(item => `- ${item}`).join('\n')}\n\n## Experiment comparison\n| Experiment | Worker | Metric | Evidence |\n| --- | --- | ---: | --- |\n${experimentTable}\n\n## Result\n${run.analysis.recommendation}\n\n## Proposed next iteration\n${nextIteration.title}\n\n${nextIteration.rationale}\n\n- Repetitions: ${nextIteration.proposedBudget.repetitions || 'not specified'}\n- Comparison: ${nextIteration.proposedBudget.comparison || 'not specified'}\n- Approval required: ${nextIteration.requiresHumanApproval}\n\n## Limitations\n${run.analysis.limitations.map(x => `- ${x}`).join('\n')}\n\n## Timeline\n${run.timeline.map(x => `- ${x.at}: ${x.event}`).join('\n')}`;
    return this.gateway.synthesize({ role: 'You write concise, auditable ML research reports.', prompt: `Write a Markdown report from this JSON. Explicitly call simulated experiments simulated.\n${JSON.stringify(run)}`, fallback });
  }
}

module.exports = { AgentGateway, ResearchAgents };
