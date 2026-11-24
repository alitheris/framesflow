// Long-running work (render, autopilot, transcription) as observable jobs.
import { EventEmitter } from 'node:events';
import { uid } from './lib.mjs';

class Jobs extends EventEmitter {
  constructor() { super(); this.map = new Map(); }

  create(type, label, { projectId } = {}) {
    const ac = new AbortController();
    const job = { id: uid('j_'), type, label, projectId, status: 'running', progress: 0, message: '', startedAt: Date.now(), endedAt: null, result: null, error: null, log: [] };
    this.map.set(job.id, { job, ac });
    this.emit('job', job);
    return { job, signal: ac.signal, update: (patch, line) => this.update(job.id, patch, line), done: r => this.finish(job.id, r), fail: e => this.fail(job.id, e) };
  }

  update(id, patch = {}, line) {
    const e = this.map.get(id); if (!e) return;
    Object.assign(e.job, patch);
    if (line) { e.job.log.push(String(line).slice(0, 300)); if (e.job.log.length > 60) e.job.log.shift(); }
    this.emit('job', e.job);
  }

  finish(id, result) { const e = this.map.get(id); if (!e) return; Object.assign(e.job, { status: 'done', progress: 1, result, endedAt: Date.now() }); this.emit('job', e.job); }

  fail(id, err) {
    const e = this.map.get(id); if (!e) return;
    const cancelled = e.ac.signal.aborted;
    Object.assign(e.job, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? 'Cancelled' : String(err?.message || err), endedAt: Date.now() });
    this.emit('job', e.job);
  }

  cancel(id) { const e = this.map.get(id); if (e && e.job.status === 'running') { e.ac.abort(); return true; } return false; }
  get(id) { return this.map.get(id)?.job || null; }
  list() { return [...this.map.values()].map(e => e.job).sort((a, b) => b.startedAt - a.startedAt).slice(0, 30); }
}

export const jobs = new Jobs();
