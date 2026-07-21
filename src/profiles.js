const PROFILES = {
  dmlfOffline: {
    keywords: ['offline dmlf', 'dmlf offline', 'synthetic dmlf', 'dmlf synthetic'], metric: 'validation_accuracy', threshold: 0.02,
    benchmark: { id: 'synthetic-ddp-smoke-v1', datasetId: 'synthetic', datasetVersion: 'deterministic-torchvision-fakedata', task: 'offline DDP execution smoke test', split: 'deterministic train/validation synthetic sets', datasetStatus: 'offline smoke test — not benchmark evidence', executionLimits: { maxEpochs: 5 }, executionEngine: 'dmlf' },
    literatureThemes: 'Validate DDP execution, metric collection, and scheduler behavior only; do not interpret synthetic results as scientific benchmark evidence.',
    experiments: [
      { name: 'baseline', requires: 'cpu', learningRate: 0.01, augmentation: 'none', dataset: 'synthetic', distributed: { nodes: 1, processesPerNode: 1, backend: 'gloo' } },
      { name: 'augmentation-cpu', requires: 'cpu', learningRate: 0.01, augmentation: 'standard', dataset: 'synthetic', distributed: { nodes: 1, processesPerNode: 1, backend: 'gloo' } },
      { name: 'tuned-learning-rate-cpu', requires: 'cpu', learningRate: 0.003, augmentation: 'standard', dataset: 'synthetic', distributed: { nodes: 1, processesPerNode: 1, backend: 'gloo' } },
    ],
  },
  dmlf: {
    keywords: ['dmlf', 'ddp', 'distributed training', 'distributed mnist'], metric: 'validation_accuracy', threshold: 0.02,
    benchmark: { id: 'mnist-ddp-v1', datasetId: 'mnist', datasetVersion: 'torchvision-recorded-at-runtime', task: 'distributed handwritten-digit classification', split: 'MNIST train/test', datasetStatus: 'downloaded and verified locally on every DMLF node', executionLimits: { maxEpochs: 5 }, executionEngine: 'dmlf' },
    literatureThemes: 'Compare the baseline against controlled augmentation and learning-rate changes while keeping DDP world size and data split fixed.',
    experiments: [
      { name: 'baseline', requires: 'cpu', learningRate: 0.01, augmentation: 'none', distributed: { nodes: 1, processesPerNode: 1, backend: 'gloo' } },
      { name: 'augmentation-cpu', requires: 'cpu', learningRate: 0.01, augmentation: 'standard', distributed: { nodes: 1, processesPerNode: 1, backend: 'gloo' } },
      { name: 'tuned-learning-rate-cpu', requires: 'cpu', learningRate: 0.003, augmentation: 'standard', distributed: { nodes: 1, processesPerNode: 1, backend: 'gloo' } },
    ],
  },
  segmentation: {
    keywords: ['brain', 'tumor', 'brats', 'segmentation', 'unet', 'mri'],
    metric: 'dice_score', threshold: 0.02,
    benchmark: { id: 'brats-limited-v1', datasetId: 'brats-user-provided', datasetVersion: 'user-supplied', task: '3D brain-tumor segmentation', split: 'user-defined train/validation split', datasetStatus: 'requires licensed/user-provided data' },
    literatureThemes: 'Compare U-Net-family baselines, preprocessing consistency, loss functions, and validation split design for segmentation.',
    experiments: [
      { name: 'unet-baseline', requires: 'gpu', learningRate: 0.0003, augmentation: 'spatial-light' },
      { name: 'dice-focal-loss', requires: 'gpu', learningRate: 0.0003, augmentation: 'spatial-light' },
      { name: 'attention-unet', requires: 'gpu', learningRate: 0.0002, augmentation: 'spatial-strong' },
    ],
  },
  transformer: {
    keywords: ['transformer', 'nlp', 'language', 'bert', 'text', 'llm', 'fine-tun'],
    metric: 'validation_accuracy', threshold: 0.015,
    benchmark: { id: 'ag-news-small-v1', datasetId: 'ag-news', datasetVersion: 'configured by worker', task: 'text classification', split: 'stratified train/validation split', datasetStatus: 'not configured in demo' },
    literatureThemes: 'Compare a frozen baseline, parameter-efficient adaptation, learning-rate schedules, and robustness across validation splits.',
    experiments: [
      { name: 'frozen-encoder-baseline', requires: 'cpu', learningRate: 0.001, augmentation: 'none' },
      { name: 'adapter-fine-tune', requires: 'gpu', learningRate: 0.0003, augmentation: 'text-light' },
      { name: 'lora-fine-tune', requires: 'gpu', learningRate: 0.0002, augmentation: 'text-light' },
    ],
  },
  vision: {
    keywords: [], metric: 'validation_accuracy', threshold: 0.02,
    benchmark: { id: 'cifar10-small-v1', datasetId: 'cifar-10', datasetVersion: 'configured by worker', task: 'image classification', split: 'standard train/test with held-out validation', datasetStatus: 'not configured in demo', executionLimits: { maxEpochs: 5 } },
    literatureThemes: 'Compare baseline performance, data quality, augmentation and regularization, and compute cost for image classification.',
    experiments: [
      { name: 'baseline', requires: 'cpu', learningRate: 0.001, augmentation: 'none' },
      { name: 'augmentation-cpu', requires: 'cpu', learningRate: 0.001, augmentation: 'standard' },
      { name: 'tuned-learning-rate-cpu', requires: 'cpu', learningRate: 0.0003, augmentation: 'standard' },
    ],
  },
};

function profileFor(question, requestedProfile = '') {
  if (requestedProfile && PROFILES[requestedProfile]) return { id: requestedProfile, ...PROFILES[requestedProfile] };
  const normalized = question.toLowerCase();
  const match = Object.entries(PROFILES).find(([name, profile]) => name !== 'vision' && profile.keywords.some(keyword => normalized.includes(keyword)));
  return { id: match?.[0] || 'vision', ...(match?.[1] || PROFILES.vision) };
}

module.exports = { profileFor };
