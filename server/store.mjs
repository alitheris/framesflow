// Single source of truth for the open project. Every change (UI, MCP, autopilot) goes through mutate().
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { HOME, readJsonSafe, writeJsonAtomic } from './lib.mjs';
import { newProject, migrateProject } from '../shared/model.mjs';

const projectsDir = path.join(HOME, 'projects');
export const projectDir = id => path.join(projectsDir, id);
export const assetsDir = id => path.join(projectDir(id), 'assets');
export const cacheDir = id => path.join(projectDir(id), 'cache');
export const rendersDir = id => path.join(projectDir(id), 'renders');

class Store extends EventEmitter {
  constructor() {
    super();
    this.project = null;
    this.rev = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.saveTimer = null;
    this.playhead = 0;
    this.activity = [];
  }

  init() {
    const last = readJsonSafe(path.join(HOME, 'last.json'), null);
    if (last?.id && fs.existsSync(path.join(projectDir(last.id), 'project.json'))) this.open(last.id);
    else if (this.list().length) this.open(this.list()[0].id);
    else this.create('My first video');
  }

  list() {
    return fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => {
      const p = readJsonSafe(path.join(projectsDir, d.name, 'project.json'), null);
      if (!p) return null;
      return { id: p.id, name: p.name, clips: p.clips?.length || 0, updated: fs.statSync(path.join(projectsDir, d.name, 'project.json')).mtimeMs };
    }).filter(Boolean).sort((a, b) => b.updated - a.updated);
  }

  create(name) {
    const p = newProject(name);
    for (const d of [projectDir(p.id), assetsDir(p.id), cacheDir(p.id), rendersDir(p.id)]) fs.mkdirSync(d, { recursive: true });
    this.project = p; this.rev = 1; this.undoStack = []; this.redoStack = [];
    this.saveNow();
    this.broadcast({ by: 'system', summary: `Created project “${name}”` });
    return p;
  }

  open(id) {
    const p = readJsonSafe(path.join(projectDir(id), 'project.json'), null);
    if (!p) throw new Error('Project not found');
    for (const d of [assetsDir(id), cacheDir(id), rendersDir(id)]) fs.mkdirSync(d, { recursive: true });
    this.project = migrateProject(p); this.rev++; this.undoStack = []; this.redoStack = [];
    this.scheduleSave();
    writeJsonAtomic(path.join(HOME, 'last.json'), { id });
    this.broadcast({ by: 'system', summary: `Opened “${p.name}”` });
    return this.project;
  }

  delete(id) {
    if (this.project?.id === id) throw new Error('Close this project before deleting it');
    fs.rmSync(projectDir(id), { recursive: true, force: true });
  }

  /**
   * Apply a change. `fn` receives a draft clone and may return a value, which mutate() returns.
   * cause: { by:'ui'|'mcp'|'auto'|'system', tool, summary, clipIds, silent }
   */
  mutate(cause, fn, { history = true } = {}) {
    const draft = structuredClone(this.project);
    const result = fn(draft);
    if (history) {
      this.undoStack.push(JSON.stringify(this.project));
      if (this.undoStack.length > 80) this.undoStack.shift();
      this.redoStack = [];
    }
    this.project = draft;
    this.rev++;
    this.scheduleSave();
    this.broadcast(cause);
    return result;
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(prev); this.rev++; this.scheduleSave();
    this.broadcast({ by: 'ui', tool: 'undo', summary: 'Undo' });
    return true;
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(next); this.rev++; this.scheduleSave();
    this.broadcast({ by: 'ui', tool: 'redo', summary: 'Redo' });
    return true;
  }

  broadcast(cause = {}) {
    if (cause.summary && !cause.silent) {
      this.activity.push({ at: Date.now(), by: cause.by || 'system', tool: cause.tool, summary: cause.summary, clipIds: cause.clipIds });
      if (this.activity.length > 200) this.activity.shift();
    }
    this.emit('change', { rev: this.rev, project: this.project, cause });
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    if (!this.project) return;
    writeJsonAtomic(path.join(projectDir(this.project.id), 'project.json'), this.project);
    writeJsonAtomic(path.join(HOME, 'last.json'), { id: this.project.id });
  }
}

export const store = new Store();
