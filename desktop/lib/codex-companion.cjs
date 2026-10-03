// SPDX-License-Identifier: Apache-2.0
// Experimental, read-only adapter for persisted Codex rollouts. Not a desktop API.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MAX_READ = 2 * 1024 * 1024;
const MAX_LINE = 1024 * 1024;
function clean(value, limit = 12000) {
  return String(value || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, limit);
}
function initialSnapshot() {
  return { enabled: false, source: 'local-rollout-experimental', status: 'idle', threadId: '',
    title: '', activity: '', result: '', turnId: '', updatedAt: '', error: '', events: [] };
}
function messageText(item) {
  return clean((Array.isArray(item?.content) ? item.content : [])
    .filter(c => ['output_text', 'text'].includes(c.type)).map(c => c.text || '').join('\n'));
}
function reduceRecord(previous, record) {
  const p = record?.payload || {};
  const next = { ...previous };
  const event = record?.type === 'event_msg' ? p.type : '';
  const timestamp = record?.timestamp || '';
  // Do not expose reasoning, tool arguments/output, credentials or user inputs.
  if (event === 'task_started') {
    next.status = 'running'; next.turnId = clean(p.turn_id, 160);
    next.result = ''; next.events = []; next.activity = 'Codexが作業中です';
  } else if (['task_complete', 'turn_aborted', 'error'].includes(event)) {
    if (p.turn_id && previous.turnId && p.turn_id !== previous.turnId) return previous;
    next.status = event === 'task_complete' ? 'completed' : event === 'turn_aborted' ? 'interrupted' : 'error';
    if (event === 'task_complete' && p.last_agent_message) next.result = clean(p.last_agent_message);
    next.activity = event === 'task_complete' ? '作業が完了しました' : event === 'turn_aborted' ? '作業が中断されました' : 'Codex側でエラーが発生しました';
  } else {
    const item = event === 'item_completed' ? p.item : record?.type === 'response_item' ? p : null;
    if (!item) return previous;
    const itemType = String(item.type || '').toLowerCase();
    if (p.turn_id && previous.turnId && p.turn_id !== previous.turnId) return previous;
    if (itemType === 'message' && item.role === 'assistant') {
      const value = messageText(item);
      if (!value) return previous;
      if (item.phase === 'commentary') next.activity = clean(value, 500);
      else if (item.phase === 'final_answer') next.result = value;
      else return previous; // Never guess the phase of an unknown record.
    } else if (itemType === 'agentmessage') {
      const value = typeof item.content === 'string' ? item.content : item.text;
      if (item.phase === 'commentary') next.activity = clean(value, 500);
      else if (item.phase === 'final_answer') next.result = clean(value);
      else return previous;
    } else if (['function_call', 'custom_tool_call', 'mcptoolcall', 'commandexecution', 'filechange'].includes(itemType)) {
      const name = String(item.name || item.tool || '');
      next.activity = /request_user_input/.test(name) ? 'Codexで入力を求めています（Codex側で確認してください）'
        : itemType === 'filechange' ? 'ファイルを更新しています'
        : itemType === 'commandexecution' ? 'コマンドを実行しています' : 'ツールを使用しています';
      if (/request_user_input/.test(name)) next.status = 'needs-input';
      else if (previous.status === 'needs-input') next.status = 'running';
    } else return previous;
  }
  next.updatedAt = timestamp;
  if (next.activity !== previous.activity) next.events = [...previous.events, { text: next.activity, timestamp }].slice(-8);
  return next;
}

class CodexCompanion {
  constructor({ root = '', onChange = () => {}, now = Date.now } = {}) {
    this.root = root; this.onChange = onChange; this.now = now;
    this.state = initialSnapshot(); this.files = new Map(); this.generation = 0;
    this.offset = 0; this.pending = Buffer.alloc(0); this.timer = null; this.identity = '';
  }
  snapshot() { return { ...this.state, events: this.state.events.map(e => ({ ...e })) }; }
  publish() { this.onChange(this.snapshot()); }
  async list(root = this.root) {
    const realRoot = await fs.realpath(root);
    if (!(await fs.stat(realRoot)).isDirectory()) throw new Error('Codexのsessionsフォルダーを選択してください。');
    const candidates = [];
    let visited = 0;
    const walk = async (directory, depth = 0) => {
      if (depth > 3 || visited++ >= 220) return;
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => b.name.localeCompare(a.name));
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const file = path.join(directory, e.name);
        if (e.isDirectory() && /^\d{2,4}$/.test(e.name)) await walk(file, depth + 1);
        else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) {
          const st = await fs.stat(file);
          candidates.push({ file, mtime: st.mtimeMs });
        }
      }
    };
    await walk(realRoot);
    candidates.sort((a, b) => b.mtime - a.mtime);
    const files = new Map(), list = [];
    for (const candidate of candidates.slice(0, 50)) {
      const handle = await fs.open(candidate.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      let meta;
      try {
        const buffer = Buffer.alloc(MAX_LINE);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const end = buffer.subarray(0, bytesRead).indexOf(10);
        if (end < 0) continue;
        const first = JSON.parse(buffer.subarray(0, end).toString('utf8'));
        if (first.type !== 'session_meta') continue;
        meta = first.payload;
      } catch { continue; } finally { await handle.close(); }
      // Desktop rollouts and CLI rollouts may share a directory. Label, don't conflate.
      const key = createHash('sha256').update(candidate.file).digest('hex');
      const threadId = clean(meta.id, 160);
      if (!threadId || typeof meta.source === 'object') continue; // exclude subagents
      const source = /desktop/i.test(String(meta.originator)) ? 'Codex Desktop' : 'Codex CLI / その他';
      const title = clean(meta.title || meta.name || `${source} · ${path.basename(String(meta.cwd || '').replace(/\\/g, '/')) || '会話'} · ${threadId.slice(0, 8)}`, 200);
      const entry = { key, threadId, title, source, updatedAt: new Date(candidate.mtime).toISOString() };
      files.set(key, { ...entry, file: candidate.file }); list.push(entry);
    }
    this.root = realRoot; this.files = files;
    return list;
  }
  async start(key) {
    const selected = this.files.get(String(key));
    if (!selected) throw new Error('会話一覧を更新し、会話を選択してください。');
    this.stop(false);
    this.selected = selected;
    this.state = { ...initialSnapshot(), enabled: true, status: 'unknown', threadId: selected.threadId, title: selected.title };
    await this.poll();
    if (this.state.enabled) {
      this.timer = setInterval(() => this.poll(), 1200); this.timer.unref?.();
    }
    return this.snapshot();
  }
  stop(publish = true) {
    this.generation++; clearInterval(this.timer); this.timer = null;
    this.selected = null; this.offset = 0; this.pending = Buffer.alloc(0); this.identity = '';
    this.state = initialSnapshot(); if (publish) this.publish();
    return this.snapshot();
  }
  async poll() {
    if (this.reading || !this.selected || !this.state.enabled) return;
    this.reading = true;
    const generation = this.generation, selected = this.selected;
    let handle;
    try {
      // Defend against a selected file being replaced by a symlink after listing.
      const resolved = await fs.realpath(selected.file);
      const relative = path.relative(this.root, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('会話ファイルの場所が変わりました。');
      handle = await fs.open(selected.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('会話ログを読み取れません。');
      const identity = `${stat.dev}:${stat.ino}`;
      const initial = !this.identity || this.identity !== identity || stat.size < this.offset;
      let offset = initial ? Math.max(0, stat.size - MAX_READ) : this.offset;
      let pending = initial ? Buffer.alloc(0) : this.pending;
      let state = initial ? { ...initialSnapshot(), enabled: true, status: 'unknown', threadId: selected.threadId, title: selected.title } : this.state;
      const length = Math.min(MAX_READ, stat.size - offset);
      let bytesRead = 0;
      if (length) {
        const buffer = Buffer.alloc(length);
        ({ bytesRead } = await handle.read(buffer, 0, length, offset));
        let chunk = buffer.subarray(0, bytesRead);
        if (initial && offset > 0) { const first = chunk.indexOf(10); chunk = first < 0 ? Buffer.alloc(0) : chunk.subarray(first + 1); }
        const combined = Buffer.concat([pending, chunk]);
        let start = 0;
        for (let end = combined.indexOf(10); end >= 0; end = combined.indexOf(10, start)) {
          if (end - start <= MAX_LINE) {
            try { state = reduceRecord(state, JSON.parse(combined.subarray(start, end).toString('utf8'))); } catch {}
          }
          start = end + 1;
        }
        pending = combined.subarray(start);
        if (pending.length > MAX_LINE) throw new Error('会話ログの形式に対応できません。');
      }
      if (generation !== this.generation) return;
      this.offset = offset + bytesRead; this.pending = pending; this.identity = identity;
      state.error = '';
      state.stale = ['running', 'needs-input'].includes(state.status)
        && (!Number.isFinite(Date.parse(state.updatedAt)) || this.now() - Date.parse(state.updatedAt) > 120000);
      const changed = JSON.stringify(state) !== JSON.stringify(this.state);
      this.state = state; if (changed) this.publish();
    } catch (error) {
      if (generation !== this.generation) return;
      this.state = { ...this.state, status: 'unknown', activity: '', error: '会話ログを確認できません。一覧更新またはsessionsフォルダーの選択をやり直してください。' };
      this.publish();
    } finally { await handle?.close().catch(() => {}); this.reading = false; }
  }
}
module.exports = { CodexCompanion, reduceRecord, initialSnapshot };
