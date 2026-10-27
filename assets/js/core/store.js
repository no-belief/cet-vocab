/* core/store.js — 唯一状态源（owner: S2），localStorage 前缀 cev1:
 * 顶层不触碰 document / localStorage：全部延迟到函数调用时，便于在 Node 里自测。
 */
import { todayKey } from './util.js';

const NS = 'cev1:';
const K_SETTINGS = NS + 'settings';
const K_RECS = NS + 'recs';
const K_DAILY = NS + 'daily';
const K_WRONG = NS + 'wrong';

const DEFAULT_SETTINGS = { level: 'cet4', dailyGoal: 20, quizSize: 10 };
const LEVELS = ['cet4', 'cet6'];
const DUE_DAYS = [0, 1, 2, 4, 7, 15];
const DAY_MS = 86400000;

let nowSource = null;
/** 测试钩子：注入时钟（生产路径默认 Date.now） */
export function __setNowForTest(fn) {
  nowSource = typeof fn === 'function' ? fn : null;
}
function now() {
  if (nowSource) {
    const v = Number(nowSource());
    if (isFinite(v)) return v;
  }
  return Date.now();
}

const mem = new Map();
const memStorage = {
  getItem(k) { return mem.has(String(k)) ? mem.get(String(k)) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  key(i) { const ks = Array.from(mem.keys()); return i >= 0 && i < ks.length ? ks[i] : null; },
  get length() { return mem.size; },
};

function ls() {
  try {
    const s = globalThis.localStorage;
    if (s && typeof s.getItem === 'function' && typeof s.setItem === 'function') return s;
  } catch (e) { /* 隐私模式等 */ }
  return memStorage;
}

function readJSON(key, fallback) {
  try {
    const raw = ls().getItem(key);
    if (raw == null || raw === '') return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    ls().setItem(key, JSON.stringify(value));
  } catch (e) { /* 配额满 / 隐私模式：静默降级 */ }
}

function num(v, def) {
  const n = Number(v);
  return isFinite(n) ? n : def;
}
function intIn(v, min, max, def) {
  const n = Math.round(num(v, def));
  return Math.min(max, Math.max(min, n));
}
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function defaultRec() {
  return { seen: 0, right: 0, wrong: 0, box: 0, last: 0, due: 0 };
}

function sanitizeRec(r) {
  const o = isPlainObject(r) ? r : {};
  return {
    seen: Math.max(0, Math.round(num(o.seen, 0))),
    right: Math.max(0, Math.round(num(o.right, 0))),
    wrong: Math.max(0, Math.round(num(o.wrong, 0))),
    box: intIn(o.box, 0, 5, 0),
    last: Math.max(0, num(o.last, 0)),
    due: Math.max(0, num(o.due, 0)),
  };
}

function readRecsRaw() {
  const v = readJSON(K_RECS, {});
  return isPlainObject(v) ? v : {};
}

function readSettings() {
  const s = readJSON(K_SETTINGS, {});
  const out = { level: DEFAULT_SETTINGS.level, dailyGoal: DEFAULT_SETTINGS.dailyGoal, quizSize: DEFAULT_SETTINGS.quizSize };
  if (isPlainObject(s)) {
    if (s.level === 'cet4' || s.level === 'cet6') out.level = s.level;
    out.dailyGoal = intIn(s.dailyGoal, 1, 1000, DEFAULT_SETTINGS.dailyGoal);
    out.quizSize = intIn(s.quizSize, 1, 200, DEFAULT_SETTINGS.quizSize);
  }
  return out;
}

function readDailyRaw() {
  const d = readJSON(K_DAILY, {});
  if (!isPlainObject(d)) return { date: '', goal: null, doneKeys: [] };
  const seen = new Set();
  const doneKeys = [];
  if (Array.isArray(d.doneKeys)) {
    for (let i = 0; i < d.doneKeys.length; i++) {
      const k = d.doneKeys[i];
      if (typeof k === 'string' && k && !seen.has(k)) { seen.add(k); doneKeys.push(k); }
    }
  }
  let goal = null;
  if (d.goal != null) goal = intIn(d.goal, 1, 1000, DEFAULT_SETTINGS.dailyGoal);
  return { date: typeof d.date === 'string' ? d.date : '', goal: goal, doneKeys: doneKeys };
}

function readWrongRaw() {
  const w = readJSON(K_WRONG, []);
  if (!Array.isArray(w)) return [];
  const out = [];
  for (let i = 0; i < w.length; i++) {
    const it = w[i];
    if (!isPlainObject(it) || typeof it.key !== 'string' || !it.key) continue;
    out.push({
      key: it.key,
      word: typeof it.word === 'string' ? it.word : '',
      level: typeof it.level === 'string' ? it.level : levelOfKey(it.key),
      count: Math.max(1, Math.round(num(it.count, 1))),
      firstAt: Math.max(0, num(it.firstAt, 0)),
      lastAt: Math.max(0, num(it.lastAt, 0)),
    });
  }
  return out;
}

function levelOfKey(key) {
  const s = String(key == null ? '' : key);
  const i = s.indexOf(':');
  return i > 0 ? s.slice(0, i) : '';
}

const subs = [];

function snapshot() {
  return { settings: readSettings(), daily: daily(), wrong: wrong() };
}

function notify() {
  const snap = snapshot();
  const list = subs.slice();
  for (let i = 0; i < list.length; i++) {
    try {
      list[i](snap);
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error('[store] subscribe 回调出错', e);
    }
  }
}

/* ---------- settings ---------- */
function settings() {
  return readSettings();
}

function updateSettings(patch) {
  const cur = readSettings();
  const p = isPlainObject(patch) ? patch : {};
  const next = { level: cur.level, dailyGoal: cur.dailyGoal, quizSize: cur.quizSize };
  if (p.level === 'cet4' || p.level === 'cet6') next.level = p.level;
  if (p.dailyGoal != null) next.dailyGoal = intIn(p.dailyGoal, 1, 1000, cur.dailyGoal);
  if (p.quizSize != null) next.quizSize = intIn(p.quizSize, 1, 200, cur.quizSize);
  writeJSON(K_SETTINGS, next);
  notify();
  return next;
}

/* ---------- rec / 掌握度 ---------- */
function rec(key) {
  const all = readRecsRaw();
  const k = String(key);
  return Object.prototype.hasOwnProperty.call(all, k) ? sanitizeRec(all[k]) : defaultRec();
}

function progressOf(key) {
  const r = rec(key);
  const mastery = Math.round((r.box / 5) * 100);
  let state;
  if (r.seen === 0) state = 'new';
  else if (r.box >= 4) state = 'mastered';
  else state = 'learning';
  return { box: r.box, mastery: mastery, state: state };
}

function markPlannedDoneInternal(key, t) {
  const s = readSettings();
  const d = readDailyRaw();
  const tk = todayKey(new Date(t));
  const goal = d.goal == null ? s.dailyGoal : d.goal;
  const doneKeys = d.date === tk ? d.doneKeys.slice() : [];
  if (doneKeys.indexOf(key) < 0) doneKeys.push(key);
  writeJSON(K_DAILY, { date: tk, goal: goal, doneKeys: doneKeys });
}

function markSeen(key, correct) {
  const k = String(key);
  const all = readRecsRaw();
  const cur = Object.prototype.hasOwnProperty.call(all, k) ? sanitizeRec(all[k]) : defaultRec();
  const t = now();
  const next = {
    seen: cur.seen + 1,
    right: cur.right + (correct ? 1 : 0),
    wrong: cur.wrong + (correct ? 0 : 1),
    box: correct ? Math.min(5, cur.box + 1) : Math.max(0, cur.box - 1),
    last: t,
    due: 0,
  };
  next.due = t + DUE_DAYS[next.box] * DAY_MS;
  all[k] = next;
  writeJSON(K_RECS, all);
  markPlannedDoneInternal(k, t);
  notify();
  return next;
}

/* ---------- 今日计划 ---------- */
function daily() {
  const s = readSettings();
  const d = readDailyRaw();
  const tk = todayKey(new Date(now()));
  const goal = d.goal == null ? s.dailyGoal : d.goal;
  const doneKeys = d.date === tk ? d.doneKeys.slice() : [];
  return { date: tk, goal: goal, doneKeys: doneKeys, doneCount: doneKeys.length };
}

function setDailyGoal(n) {
  const s = readSettings();
  const d = readDailyRaw();
  const tk = todayKey(new Date(now()));
  const goal = intIn(n, 1, 1000, s.dailyGoal);
  writeJSON(K_DAILY, { date: tk, goal: goal, doneKeys: d.date === tk ? d.doneKeys : [] });
  notify();
  return daily();
}

function markPlannedDone(key) {
  const k = String(key);
  const t = now();
  markPlannedDoneInternal(k, t);
  notify();
  return daily();
}

/* ---------- 错词本 ---------- */
function wrong() {
  return readWrongRaw().sort(function (a, b) {
    if (b.lastAt !== a.lastAt) return b.lastAt - a.lastAt;
    return b.firstAt - a.firstAt;
  });
}

function addWrong(entry) {
  const e = isPlainObject(entry) ? entry : {};
  const k = String(e.key == null ? '' : e.key);
  if (!k) throw new Error('addWrong 需要 key');
  const list = readWrongRaw();
  const t = now();
  let hit = null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].key === k) { hit = list[i]; break; }
  }
  let out;
  if (hit) {
    hit.count += 1;
    hit.lastAt = t;
    if (e.word) hit.word = String(e.word);
    if (e.level) hit.level = String(e.level);
    out = hit;
  } else {
    out = {
      key: k,
      word: e.word == null ? '' : String(e.word),
      level: e.level == null ? levelOfKey(k) : String(e.level),
      count: 1,
      firstAt: t,
      lastAt: t,
    };
    list.push(out);
  }
  writeJSON(K_WRONG, list);
  notify();
  return { key: out.key, word: out.word, level: out.level, count: out.count, firstAt: out.firstAt, lastAt: out.lastAt };
}

function removeWrong(key) {
  const k = String(key);
  const list = readWrongRaw().filter(function (it) { return it.key !== k; });
  writeJSON(K_WRONG, list);
  notify();
  return wrong();
}

function clearWrong() {
  writeJSON(K_WRONG, []);
  notify();
  return [];
}

/* ---------- 统计 ---------- */
function stats(level, total) {
  const target = level == null || level === '' ? null : String(level);
  const all = readRecsRaw();
  let seen = 0;
  let mastered = 0;
  let learning = 0;
  let right = 0;
  let wrongCount = 0;
  const keys = Object.keys(all);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (target && levelOfKey(k) !== target) continue;
    const r = sanitizeRec(all[k]);
    if (r.seen > 0) {
      seen += 1;
      if (r.box >= 4) mastered += 1;
      else learning += 1;
    }
    right += r.right;
    wrongCount += r.wrong;
  }
  let totalNum = 0;
  if (target) {
    if (typeof total === 'number' && isFinite(total)) totalNum = Math.max(0, Math.round(total));
  } else if (isPlainObject(total)) {
    const vs = Object.keys(total);
    for (let i = 0; i < vs.length; i++) {
      const n = Number(total[vs[i]]);
      if (isFinite(n)) totalNum += Math.max(0, Math.round(n));
    }
  } else if (typeof total === 'number' && isFinite(total)) {
    totalNum = Math.max(0, Math.round(total));
  }
  const attempts = right + wrongCount;
  const accuracy = attempts > 0 ? Math.round((right / attempts) * 1000) / 1000 : 0;
  return {
    total: totalNum,
    seen: seen,
    mastered: mastered,
    learning: learning,
    untouched: Math.max(0, totalNum - seen),
    accuracy: accuracy,
  };
}

/* ---------- 导入 / 导出 / 重置 ---------- */
function exportAll() {
  const recs = {};
  const all = readRecsRaw();
  const keys = Object.keys(all);
  for (let i = 0; i < keys.length; i++) recs[keys[i]] = sanitizeRec(all[keys[i]]);
  return {
    v: 1,
    exportedAt: new Date(now()).toISOString(),
    settings: readSettings(),
    recs: recs,
    daily: daily(),
    wrong: wrong(),
  };
}

function importAll(obj) {
  if (!isPlainObject(obj)) throw new Error('进度数据格式不正确：需要一个 JSON 对象');

  let nextSettings = readSettings();
  if (obj.settings !== undefined) {
    if (!isPlainObject(obj.settings)) throw new Error('进度数据格式不正确：settings 非法');
    const s = obj.settings;
    nextSettings = {
      level: s.level === 'cet4' || s.level === 'cet6' ? s.level : nextSettings.level,
      dailyGoal: s.dailyGoal == null ? nextSettings.dailyGoal : intIn(s.dailyGoal, 1, 1000, nextSettings.dailyGoal),
      quizSize: s.quizSize == null ? nextSettings.quizSize : intIn(s.quizSize, 1, 200, nextSettings.quizSize),
    };
  }

  const nextRecs = {};
  if (obj.recs !== undefined) {
    if (!isPlainObject(obj.recs)) throw new Error('进度数据格式不正确：recs 必须是对象');
    const keys = Object.keys(obj.recs);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const r = obj.recs[k];
      if (!isPlainObject(r)) throw new Error('进度数据格式不正确：recs["' + k + '"] 必须是对象');
      nextRecs[k] = sanitizeRec(r);
    }
  }

  let nextWrong = [];
  if (obj.wrong !== undefined) {
    if (!Array.isArray(obj.wrong)) throw new Error('进度数据格式不正确：wrong 必须是数组');
    for (let i = 0; i < obj.wrong.length; i++) {
      const it = obj.wrong[i];
      if (!isPlainObject(it) || typeof it.key !== 'string' || !it.key) {
        throw new Error('进度数据格式不正确：wrong[' + i + '].key 必须是字符串');
      }
      nextWrong.push({
        key: it.key,
        word: typeof it.word === 'string' ? it.word : '',
        level: typeof it.level === 'string' ? it.level : levelOfKey(it.key),
        count: Math.max(1, Math.round(num(it.count, 1))),
        firstAt: Math.max(0, num(it.firstAt, 0)),
        lastAt: Math.max(0, num(it.lastAt, 0)),
      });
    }
  }

  if (obj.daily !== undefined) {
    if (!isPlainObject(obj.daily)) throw new Error('进度数据格式不正确：daily 必须是对象');
  }

  writeJSON(K_SETTINGS, nextSettings);
  writeJSON(K_RECS, nextRecs);
  if (isPlainObject(obj.daily)) {
    const d = obj.daily;
    const doneKeys = [];
    if (Array.isArray(d.doneKeys)) {
      for (let i = 0; i < d.doneKeys.length; i++) {
        if (typeof d.doneKeys[i] === 'string' && d.doneKeys[i]) doneKeys.push(d.doneKeys[i]);
      }
    }
    writeJSON(K_DAILY, {
      date: typeof d.date === 'string' ? d.date : '',
      goal: d.goal == null ? nextSettings.dailyGoal : intIn(d.goal, 1, 1000, nextSettings.dailyGoal),
      doneKeys: doneKeys,
    });
  }
  writeJSON(K_WRONG, nextWrong);
  notify();
  return true;
}

function reset() {
  const storage = ls();
  const doomed = [];
  try {
    const n = Number(storage.length) || 0;
    for (let i = 0; i < n; i++) {
      const k = storage.key(i);
      if (typeof k === 'string' && k.indexOf(NS) === 0) doomed.push(k);
    }
  } catch (e) { /* 忽略 */ }
  for (let i = 0; i < doomed.length; i++) {
    try { storage.removeItem(doomed[i]); } catch (e) { /* 忽略 */ }
  }
  mem.clear();
  notify();
}

function subscribe(fn) {
  if (typeof fn !== 'function') return function () {};
  subs.push(fn);
  let active = true;
  return function unwatch() {
    if (!active) return;
    active = false;
    const i = subs.indexOf(fn);
    if (i >= 0) subs.splice(i, 1);
  };
}

export const store = {
  settings: settings,
  updateSettings: updateSettings,
  rec: rec,
  markSeen: markSeen,
  progressOf: progressOf,
  daily: daily,
  setDailyGoal: setDailyGoal,
  markPlannedDone: markPlannedDone,
  wrong: wrong,
  addWrong: addWrong,
  removeWrong: removeWrong,
  clearWrong: clearWrong,
  stats: stats,
  exportAll: exportAll,
  importAll: importAll,
  reset: reset,
  subscribe: subscribe,
};

export default store;
