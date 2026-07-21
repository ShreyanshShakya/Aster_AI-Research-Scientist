const fs = require('node:fs/promises');
const path = require('node:path');

const defaults = Object.freeze({
  enabled: false,
  bridgeEndpoint: 'http://127.0.0.1:8002',
  managerAddress: '127.0.0.1:50051',
  requestedNodes: 1,
  nodes: [],
});

function normalizeDmlfConfig(value = {}) {
  const bridgeEndpoint = String(value.bridgeEndpoint || defaults.bridgeEndpoint).replace(/\/$/, '');
  const parsed = new URL(bridgeEndpoint);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('DMLF bridge endpoint must use HTTP or HTTPS.');
  const requestedNodes = Math.max(1, Math.min(Number(value.requestedNodes || defaults.requestedNodes), 16));
  const nodes = Array.isArray(value.nodes) ? value.nodes.slice(0, 16).map((node, index) => ({
    id: String(node.id || `node-${index + 1}`).slice(0, 80),
    host: String(node.host || '').slice(0, 160),
    resource: node.resource === 'gpu' ? 'gpu' : 'cpu',
    processesPerNode: Math.max(1, Math.min(Number(node.processesPerNode || 1), 8)),
  })) : [];
  return { enabled: value.enabled === true, bridgeEndpoint, managerAddress: String(value.managerAddress || defaults.managerAddress).slice(0, 160), requestedNodes, nodes };
}

class DmlfConfigStore {
  constructor(dataDir) { this.file = path.join(dataDir, 'dmlf-config.json'); }
  async get() { try { return normalizeDmlfConfig(JSON.parse(await fs.readFile(this.file, 'utf8'))); } catch (error) { if (error.code === 'ENOENT') return { ...defaults }; throw error; } }
  async save(value) { const config = normalizeDmlfConfig(value); await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(this.file, JSON.stringify(config, null, 2)); return config; }
}

module.exports = { DmlfConfigStore, normalizeDmlfConfig, defaults };
