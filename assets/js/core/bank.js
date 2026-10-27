/* core/bank.js — 词库加载（owner: S2）
 * 所有资源都是相对路径（GitHub Pages 仓库子路径部署）。
 */
import { sample } from './util.js';

const manifestState = { promise: null };
const pool = new Map(); // level -> { promise, words, byWord }

function dataUrl(name) {
  const rel = './data/' + name;
  try {
    if (typeof document !== 'undefined' && document.baseURI) return new URL(rel, document.baseURI).href;
  } catch (e) { /* ignore */ }
  return rel;
}

function fetchJSON(name) {
  return fetch(dataUrl(name)).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + name);
    return res.json();
  });
}

function manifest() {
  if (!manifestState.promise) {
    manifestState.promise = fetchJSON('manifest.json').catch(function (err) {
      manifestState.promise = null;
      const e = new Error('词库清单加载失败');
      e.cause = err;
      throw e;
    });
  }
  return manifestState.promise;
}

function toItem(level, w) {
  const src = w || {};
  return {
    level: level,
    word: typeof src.word === 'string' ? src.word : String(src.word || ''),
    ipa: typeof src.ipa === 'string' ? src.ipa : '',
    ipaUs: typeof src.ipaUs === 'string' ? src.ipaUs : '',
    meanings: Array.isArray(src.meanings) ? src.meanings.slice() : [],
    pos: src.pos == null ? null : src.pos,
    example: src.example == null ? null : src.example,
    key: level + ':' + (typeof src.word === 'string' ? src.word : String(src.word || '')),
  };
}

function load(level) {
  const lv = String(level);
  const hit = pool.get(lv);
  if (hit) return hit.promise;
  const entry = { promise: null, words: null, byWord: null };
  entry.promise = fetchJSON(lv + '.json')
    .then(function (data) {
      if (!data || !Array.isArray(data.words)) throw new Error('词库格式不正确：' + lv);
      const words = data.words;
      const byWord = new Map();
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w && typeof w.word === 'string' && !byWord.has(w.word)) byWord.set(w.word, w);
      }
      entry.words = words;
      entry.byWord = byWord;
      return { level: typeof data.level === 'string' ? data.level : lv, label: typeof data.label === 'string' ? data.label : lv, words: words };
    })
    .catch(function (err) {
      pool.delete(lv);
      const e = new Error('词库加载失败（请确认通过 http 服务访问，而不是 file:// 打开）');
      e.cause = err;
      throw e;
    });
  pool.set(lv, entry);
  return entry.promise;
}

function loaded(level) {
  const hit = pool.get(String(level));
  return hit && hit.words ? hit.words : null;
}

function word(level, key) {
  const lv = String(level);
  const hit = pool.get(lv);
  if (!hit || !hit.byWord) return null;
  const k = String(key == null ? '' : key);
  const i = k.indexOf(':');
  const bare = i > 0 ? k.slice(i + 1) : k;
  return hit.byWord.get(bare) || null;
}

function items(levels) {
  const lvs = Array.isArray(levels) ? levels : levels ? [levels] : [];
  const jobs = lvs.map(function (lv) {
    return load(lv).then(function (data) {
      const out = [];
      for (let i = 0; i < data.words.length; i++) out.push(toItem(String(lv), data.words[i]));
      return out;
    });
  });
  return Promise.all(jobs).then(function (groups) {
    let all = [];
    for (let i = 0; i < groups.length; i++) all = all.concat(groups[i]);
    return all;
  });
}

function random(opts) {
  const o = opts || {};
  const count = Math.max(0, Math.floor(Number(o.count) || 0));
  const levels = Array.isArray(o.levels) ? o.levels : o.levels ? [o.levels] : [];
  const exclude = o.exclude instanceof Set ? o.exclude : new Set(Array.isArray(o.exclude) ? o.exclude : []);
  return items(levels).then(function (all) {
    const usable = all.filter(function (it) { return !exclude.has(it.key); });
    return sample(usable, Math.min(count, usable.length));
  });
}

function count(level) {
  return manifest().then(function (m) {
    const info = m && m.levels ? m.levels[String(level)] : null;
    const n = Number(info && info.count);
    return isFinite(n) ? n : 0;
  });
}

export const bank = {
  manifest: manifest,
  load: load,
  loaded: loaded,
  word: word,
  items: items,
  random: random,
  count: count,
};

export default bank;
