const fs = require('node:fs/promises');
const path = require('node:path');

class RunStore {
  constructor(dataDir) { this.file = path.join(dataDir, 'runs.json'); }
  async all() { try { return JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; } }
  async save(run) { const runs = await this.all(); runs[run.id] = run; await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(this.file, JSON.stringify(runs, null, 2)); return run; }
  async get(id) { return (await this.all())[id] || null; }
  async list() { return Object.values(await this.all()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
}
module.exports = { RunStore };
