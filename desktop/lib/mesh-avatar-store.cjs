// SPDX-License-Identifier: Apache-2.0
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { PNG } = require('pngjs');
const { parseRig } = require('../../vendor/mesh-avatar-studio/rig-validator.cjs');
const ID = /^[a-f0-9-]{36}$/;
const NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const LIMIT = 80 * 1024 * 1024;
function assert(condition, message) { if (!condition) throw new Error(message); }
function boundedJson(body) {
  assert(body.length <= 1024 * 1024, 'アバター設定が大きすぎます。');
  const value = JSON.parse(body);
  let count = 0;
  function visit(v, depth = 0) {
    assert(++count < 30000 && depth < 24, 'アバター設定が複雑すぎます。');
    if (typeof v === 'number') assert(Number.isFinite(v) && Math.abs(v) < 1e6, 'アバター設定に不正な数値があります。');
    if (v && typeof v === 'object') for (const [k, child] of Object.entries(v)) {
      assert(!['__proto__','constructor','prototype'].includes(k), 'アバター設定に不正な項目があります。'); visit(child, depth + 1);
    }
  }
  visit(value); return value;
}
function readProject(directory) {
  const realRoot = fs.realpathSync(directory), files = new Map(); let bytes = 0, pixels = 0;
  const read = file => {
    if (files.has(file)) return files.get(file);
    const target = fs.realpathSync(path.join(realRoot, file));
    assert(target.startsWith(realRoot + path.sep), 'プロジェクトの外にある画像は読み込めません。');
    const stat = fs.statSync(target);
    assert(stat.isFile() && stat.size <= 16 * 1024 * 1024 && bytes + stat.size <= LIMIT, 'プロジェクトは80MB以下、各ファイルは16MB以下にしてください。');
    const body = fs.readFileSync(target); bytes += body.length; files.set(file, body); return body;
  };
  const rig = parseRig(boundedJson(read('rig.json')));
  const { width, height } = rig.image;
  assert(width >= 32 && height >= 32 && width <= 4096 && height <= 4096, '画像の幅・高さは32〜4096pxにしてください。');
  for (const key of ['baseCell','handCell','tasselCell','eyeBallCell','eyeCell','spriteCell']) assert(rig.mesh[key] >= 3, 'メッシュの分割間隔は3px以上にしてください。');
  assert(rig.mesh.fine.cell >= 3 && width * height / Math.min(rig.mesh.baseCell, rig.mesh.fine.cell) ** 2 < 150000, 'メッシュが細かすぎます。');
  assert(rig.mesh.fine.x0 >= 0 && rig.mesh.fine.y0 >= 0 && rig.mesh.fine.x1 <= width && rig.mesh.fine.y1 <= height, '細分化する範囲は画像内にしてください。');
  assert((rig.strands || []).every(x => x.nodes.length <= 128), '髪の制御点が多すぎます。');
  assert((rig.strands || []).length <= 32 && (rig.accessories || []).length <= 16, '髪や飾りの数が多すぎます。');
  for (const item of [...(rig.strands || []), ...(rig.accessories || [])]) assert(NAME.test(item.name), 'レイヤー名に使用できない文字があります。');
  const meta = boundedJson(read('built/layers.json'));
  assert(JSON.stringify(meta.size) === JSON.stringify([width,height]), '画像とレイヤー設定のサイズが一致しません。');
  const rect = value => Array.isArray(value) && value.length === 4 && value.every(Number.isInteger)
    && value[0] >= 0 && value[1] >= 0 && value[2] > 0 && value[3] > 0 && value[0] + value[2] <= width && value[1] + value[3] <= height;
  const names = ['base','hairmask', ...[0,1].flatMap(i => ['ball','low','crease','lash'].map(part => `eye${i}_${part}`)),
    ...(rig.hand ? ['hand'] : []), ...(rig.accessories || []).map(x => x.name)];
  function image(file, expected) {
    const body = read(file);
    assert(body.length > 24 && body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'PNG画像を使用してください。');
    const w = body.readUInt32BE(16), h = body.readUInt32BE(20);
    assert(w === expected[0] && h === expected[1] && (pixels += w*h) <= 40000000, 'レイヤー画像のサイズが一致しないか、大きすぎます。');
    PNG.sync.read(body, { checkCRC: true });
  }
  for (const name of names) {
    if (['base','hairmask'].includes(name)) image(`built/${name}.png`, [width,height]);
    else { assert(rect(meta.layers?.[name]), `レイヤー「${name}」の位置が不正です。`); image(`built/${name}.png`, meta.layers[name].slice(2)); }
  }
  if (fs.existsSync(path.join(realRoot, 'built/sprites/sprites.json'))) {
    const sheet = boundedJson(read('built/sprites/sprites.json'));
    assert(sheet.layers && Object.keys(sheet.layers).length <= 32, '目・口の描き分け設定が不正です。');
    for (const [name, box] of Object.entries(sheet.layers)) {
      assert(NAME.test(name) && rect(box), '目・口の描き分け位置が不正です。'); image(`built/sprites/${name}.png`, box.slice(2));
    }
  }
  const hash = createHash('sha256'); for (const [file,body] of files) hash.update(file).update(body);
  return { files, width, height, version: hash.digest('hex').slice(0,16) };
}
class MeshAvatarStore {
  constructor(directory) {
    this.directory = path.resolve(directory); fs.mkdirSync(this.directory,{recursive:true}); this.records = new Map();
    for (const name of fs.readdirSync(this.directory)) {
      if (!ID.test(name)) continue;
      try {
        const record = boundedJson(fs.readFileSync(path.join(this.directory,name,'import.json')));
        if (record.id === name && /^[a-zA-Z0-9_-]{1,100}$/.test(record.characterId) && typeof record.label === 'string' && record.label.length <= 80
          && /^[a-f0-9]{16}$/.test(record.version) && [record.width,record.height].every(n => Number.isInteger(n) && n >= 32 && n <= 4096)
          && Array.isArray(record.files) && record.files.length <= 100 && record.files.includes('rig.json')
          && record.files.every(file => typeof file === 'string' && /^(rig\.json|built\/[a-zA-Z0-9_/-]+\.(json|png))$/.test(file) && !file.includes('..') && fs.existsSync(path.join(this.directory,name,file)))) this.records.set(name,record);
      } catch { /* An incomplete import is not offered. */ }
    }
  }
  list(characterId) { return [...this.records.values()].filter(x => x.characterId === characterId).map(({id,label}) => ({id,label})); }
  import(directory, characterId) {
    const project = readProject(directory);
    const existing = [...this.records.values()].find(x => x.characterId === characterId && x.version === project.version);
    if (existing) return {id: existing.id, label: existing.label};
    assert(this.list(characterId).length < 20, 'このキャラクターの見た目は20個までです。');
    const id = randomUUID(), target = path.join(this.directory,id);
    const base = path.basename(directory).slice(0,70), labels = new Set(this.list(characterId).map(x => x.label));
    let label = base, suffix = 2; while (labels.has(label)) label = `${base} (${suffix++})`;
    const record = { id, characterId, label, width: project.width, height: project.height,
      version: project.version, files: [...project.files.keys()] };
    fs.mkdirSync(target);
    try {
      for (const [file,body] of project.files) { const output = path.join(target,file); fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,body); }
      fs.writeFileSync(path.join(target,'import.json'),JSON.stringify(record)); this.records.set(id,record);
      return { id, label: record.label };
    } catch (error) { fs.rmSync(target,{recursive:true,force:true}); throw error; }
  }
  descriptor(characterId, id) {
    const record = this.records.get(id);
    if (!record || record.characterId !== characterId) return null;
    return { id, version: record.version, width: record.width, height: record.height,
      rigUrl: `/api/mesh/${id}/rig.json`, assetsBase: `/api/mesh/${id}/built/` };
  }
  read(characterId, id, file) {
    const record = this.records.get(id);
    if (!record || record.characterId !== characterId || !record.files.includes(file) || !/^(rig\.json|built\/[a-zA-Z0-9_/-]+\.(json|png))$/.test(file) || file.includes('..')) return null;
    const root = fs.realpathSync(path.join(this.directory,id)), target = fs.realpathSync(path.join(root,file));
    assert(target.startsWith(root + path.sep), 'Invalid mesh asset');
    return { body: fs.readFileSync(target), contentType: file.endsWith('.png') ? 'image/png' : 'application/json; charset=utf-8' };
  }
}
module.exports = { MeshAvatarStore, readProject };
