/* assets/js/features/progress.js — 学习进度与掌握程度（owner: S4）
 * 顶层只做 import 与 const；纯逻辑用具名导出的函数，便于 scripts/selftest-plan-progress.mjs 在 Node 里断言。
 * 掌握度口径完全照 store 的规则：box 0–5、mastery = round(box/5*100)、box>=4 记「已掌握」。
 */
import { bank } from '../core/bank.js';
import { store } from '../core/store.js';
import { el, emptyState, fmtPct, toast } from '../core/util.js';

const LEVELS = ['cet4', 'cet6'];
const LEVEL_TEXT = { cet4: '四级', cet6: '六级' };

export const BOX_MAX = 5;
export const MASTERED_BOX = 4;
export const BOX_PCT = [0, 20, 40, 60, 80, 100];
export const LIST_LIMIT = 300;
export const STATE_LABEL = { new: '未开始', learning: '学习中', mastered: '已掌握' };

/* ---------- 纯逻辑（Node 可测） ---------- */

function toInt(v, def) {
  const n = Math.round(Number(v));
  return isFinite(n) ? n : def;
}

/** "cet4:cancel" → {level:'cet4', word:'cancel'}；无前缀时 level 为空串。 */
export function splitKey(key) {
  const s = key == null ? '' : String(key);
  const i = s.indexOf(':');
  if (i <= 0) return { level: '', word: s };
  return { level: s.slice(0, i), word: s.slice(i + 1) };
}

/** 把 store.stats() 的结果收敛成四段计数（untouched 缺失时用 total-seen 兜底）。 */
export function bucketOf(stats) {
  const s = stats && typeof stats === 'object' ? stats : {};
  const total = Math.max(0, toInt(s.total, 0));
  const seen = Math.max(0, toInt(s.seen, 0));
  const mastered = Math.min(seen, Math.max(0, toInt(s.mastered, 0)));
  const learning = Math.min(Math.max(0, seen - mastered), Math.max(0, toInt(s.learning, 0)));
  const untouched = typeof s.untouched === 'number' && isFinite(s.untouched)
    ? Math.max(0, toInt(s.untouched, 0))
    : Math.max(0, total - seen);
  return { total: total, seen: seen, mastered: mastered, learning: learning, untouched: untouched };
}

/** 堆叠条百分比：三段四舍五入到整数且和恒为 100（最大余数法补偿）；全 0 时返回全 0。 */
export function stackPercents(parts) {
  const p = parts && typeof parts === 'object' ? parts : {};
  const counts = [Math.max(0, toInt(p.mastered, 0)), Math.max(0, toInt(p.learning, 0)), Math.max(0, toInt(p.untouched, 0))];
  const total = counts[0] + counts[1] + counts[2];
  if (total <= 0) return { mastered: 0, learning: 0, untouched: 0, total: 0 };
  const raw = [counts[0] / total * 100, counts[1] / total * 100, counts[2] / total * 100];
  const out = [Math.floor(raw[0]), Math.floor(raw[1]), Math.floor(raw[2])];
  let rest = 100 - (out[0] + out[1] + out[2]);
  const order = [0, 1, 2].sort(function (a, b) {
    const fa = raw[a] - out[a];
    const fb = raw[b] - out[b];
    if (fb !== fa) return fb - fa;
    return a - b;
  });
  for (let i = 0; rest > 0 && i < order.length; i++, rest--) out[order[i]] += 1;
  return { mastered: out[0], learning: out[1], untouched: out[2], total: total };
}

function sortValue(row, key) {
  if (key === 'recent') return Math.max(0, toInt(row && row.last, 0));
  if (key === 'word') return String((row && row.word) || '').toLowerCase();
  return Math.max(0, Math.min(100, toInt(row && row.mastery, 0)));
}

/** 稳定排序：key ∈ mastery|recent|word，dir ∈ asc|desc（同值时保持原始顺序）。 */
export function sortLearned(rows, key, dir) {
  const list = Array.isArray(rows) ? rows : [];
  const k = key === 'recent' || key === 'word' ? key : 'mastery';
  const d = dir === 'asc' || dir === 'desc' ? dir : (k === 'recent' ? 'desc' : 'asc');
  const sign = d === 'asc' ? 1 : -1;
  const deco = list.map(function (row, i) { return { row: row, i: i, v: sortValue(row, k) }; });
  deco.sort(function (a, b) {
    let c;
    if (typeof a.v === 'string' || typeof b.v === 'string') {
      const x = String(a.v);
      const y = String(b.v);
      c = x < y ? -1 : (x > y ? 1 : 0);
    } else {
      c = a.v === b.v ? 0 : (a.v < b.v ? -1 : 1);
    }
    if (c !== 0) return c * sign;
    return a.i - b.i;
  });
  return deco.map(function (o) { return o.row; });
}

/** 按单词或释义做大小写无关的包含匹配。 */
export function filterRows(rows, query) {
  const list = Array.isArray(rows) ? rows : [];
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter(function (row) {
    if (String((row && row.word) || '').toLowerCase().indexOf(q) >= 0) return true;
    const ms = row && Array.isArray(row.meanings) ? row.meanings : [];
    for (let i = 0; i < ms.length; i++) {
      if (String(ms[i]).toLowerCase().indexOf(q) >= 0) return true;
    }
    return false;
  });
}

/** 与 store.progressOf 同一口径，但可从已有 rec 直接算（列表渲染避免逐词重读 localStorage）。 */
export function progressFromRec(rec) {
  const r = rec && typeof rec === 'object' ? rec : {};
  const seen = Math.max(0, toInt(r.seen, 0));
  const box = Math.max(0, Math.min(BOX_MAX, toInt(r.box, 0)));
  let state;
  if (seen === 0) state = 'new';
  else if (box >= MASTERED_BOX) state = 'mastered';
  else state = 'learning';
  return { box: box, mastery: Math.round(box / BOX_MAX * 100), state: state };
}

/** 组装一行单词级进度：word 可为 null（词库未就绪时降级成 key 里的单词）。 */
export function progressRow(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const parts = splitKey(o.key);
  const w = o.word && typeof o.word === 'object' ? o.word : null;
  const p = progressFromRec(Object.assign({ seen: 1 }, o.rec || {}));
  const derived = o.progress && typeof o.progress === 'object' ? o.progress : p;
  return {
    key: o.key == null ? '' : String(o.key),
    level: parts.level || (o.level == null ? '' : String(o.level)),
    word: w && typeof w.word === 'string' && w.word ? w.word : parts.word,
    ipa: w && typeof w.ipa === 'string' ? w.ipa : '',
    meanings: w && Array.isArray(w.meanings) ? w.meanings.slice() : [],
    box: Math.max(0, Math.min(BOX_MAX, toInt(derived.box, 0))),
    mastery: Math.max(0, Math.min(100, toInt(derived.mastery, 0))),
    state: STATE_LABEL[derived.state] ? derived.state : p.state,
    last: Math.max(0, toInt(o.last, 0)),
  };
}

/** 图例：box 0–5 → 0/20/40/60/80/100%。 */
export function masteryLegend() {
  return BOX_PCT.map(function (pct, box) {
    return { box: box, pct: pct, mastered: box >= MASTERED_BOX };
  });
}

/** 时间戳 → "YYYY-MM-DD"（本地时区），0/非法值返回空串。 */
export function fmtDay(ts) {
  const n = Number(ts);
  if (!isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  if (!isFinite(d.getTime())) return '';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

/* ---------- DOM 小工具 ---------- */

function levelText(level) {
  return LEVEL_TEXT[level] || (level ? String(level).toUpperCase() : '单词');
}

function levelChipClass(level) {
  if (level === 'cet4') return 'chip chip--cet4';
  if (level === 'cet6') return 'chip chip--cet6';
  return 'chip';
}

/* ---------- 视图 ---------- */

export const route = {
  name: 'progress',
  title: '学习进度',
  mount: function mount(root) {
    let level = 'all';
    let sortKey = 'mastery';
    let sortDir = 'asc';
    let query = '';
    let askReset = false;
    let disposed = false;
    let totals = null;
    let rowsCache = [];
    let curStats = null;
    let tick = 0;
    const failedLevels = new Set();

    /* --- 总览 --- */
    function statNode(label) {
      const num = el('span', { class: 'stat__num', text: '0' });
      return { num: num, node: el('div', { class: 'stat' }, [num, el('span', { class: 'stat__label', text: label })]) };
    }
    const sSeen = statNode('已学词数');
    const sMastered = statNode('已掌握');
    const sLearning = statNode('学习中');
    const sUntouched = statNode('未开始');
    const sAcc = statNode('正确率');

    const levelSelect = el('select', { class: 'select pv-level-select', id: 'pv-level' }, [
      el('option', { value: 'all', text: '全部级别' }),
      el('option', { value: 'cet4', text: '四级' }),
      el('option', { value: 'cet6', text: '六级' }),
    ]);
    levelSelect.value = level;

    const overviewPanel = el('section', { class: 'panel pv-overview', 'aria-labelledby': 'pv-overview-title' }, [
      el('div', { class: 'pv-head' }, [
        el('h2', { class: 'pv-title', id: 'pv-overview-title', text: '总览' }),
        el('span', { class: 'spacer' }),
        el('label', { class: 'sr-only', for: 'pv-level', text: '统计范围' }),
        levelSelect,
      ]),
      el('div', { class: 'stat-grid' }, [sSeen.node, sMastered.node, sLearning.node, sUntouched.node, sAcc.node]),
      el('p', { class: 'pv-hint', text: '正确率 = 答对次数 /（答对 + 答错），来自全部练习记录。' }),
    ]);

    /* --- 掌握度堆叠条 --- */
    const bars = el('div', { class: 'pv-bars' });
    const barsPanel = el('section', { class: 'panel', 'aria-labelledby': 'pv-bars-title' }, [
      el('h2', { class: 'pv-title', id: 'pv-bars-title', text: '掌握度分布' }),
      bars,
    ]);

    /* --- 单词级列表 --- */
    const searchInput = el('input', {
      class: 'input pv-search',
      id: 'pv-search',
      type: 'search',
      placeholder: '搜索单词或释义',
      'aria-label': '搜索单词或释义',
    });
    const sortSelect = el('select', { class: 'select pv-sort', id: 'pv-sort' }, [
      el('option', { value: 'mastery:asc', text: '掌握度 低→高' }),
      el('option', { value: 'mastery:desc', text: '掌握度 高→低' }),
      el('option', { value: 'recent:desc', text: '最近学习 新→旧' }),
      el('option', { value: 'recent:asc', text: '最近学习 旧→新' }),
      el('option', { value: 'word:asc', text: '单词 A→Z' }),
    ]);
    sortSelect.value = sortKey + ':' + sortDir;

    const listInfo = el('p', { class: 'pv-hint', role: 'status', 'aria-live': 'polite' });
    const listBody = el('div', { class: 'pv-list' });

    const listPanel = el('section', { class: 'panel', 'aria-labelledby': 'pv-list-title' }, [
      el('h2', { class: 'pv-title', id: 'pv-list-title', text: '单词掌握度' }),
      el('div', { class: 'pv-toolbar' }, [
        el('label', { class: 'sr-only', for: 'pv-sort', text: '排序方式' }),
        searchInput,
        sortSelect,
      ]),
      listInfo,
      listBody,
    ]);

    /* --- 图例 --- */
    const legendItems = masteryLegend().map(function (it) {
      return el('span', { class: 'pv-legend__item' }, [
        el('span', { class: 'pw-box' }, [1, 2, 3, 4, 5].map(function (i) {
          let cls = 'pw-box__cell';
          if (i <= it.box) cls += it.mastered ? ' is-mastered' : ' is-on';
          return el('span', { class: cls });
        })),
        el('span', { text: 'box ' + it.box + ' → ' + it.pct + '%' }),
      ]);
    });
    const legendPanel = el('section', { class: 'panel', 'aria-labelledby': 'pv-legend-title' }, [
      el('h2', { class: 'pv-title', id: 'pv-legend-title', text: '掌握度说明' }),
      el('p', { class: 'pv-desc', text: '每学一次：答对 box+1（上限 5），答错 box-1（下限 0）；掌握度 = box ÷ 5 × 100%。box ≥ ' + MASTERED_BOX + ' 记为「已掌握」，与学习记录里的判定完全一致。' }),
      el('div', { class: 'pv-legend' }, legendItems),
      el('div', { class: 'pv-legend pv-legend--stack' }, [
        el('span', { class: 'pv-legend__item' }, [el('span', { class: 'pv-legend__swatch pv-legend__swatch--mastered' }), el('span', { text: '已掌握（box ≥ ' + MASTERED_BOX + '）' })]),
        el('span', { class: 'pv-legend__item' }, [el('span', { class: 'pv-legend__swatch pv-legend__swatch--learning' }), el('span', { text: '学习中（已学未掌握）' })]),
        el('span', { class: 'pv-legend__item' }, [el('span', { class: 'pv-legend__swatch pv-legend__swatch--untouched' }), el('span', { text: '未开始' })]),
      ]),
    ]);

    /* --- 重置 --- */
    const resetBody = el('div', { class: 'pv-reset' });
    const resetPanel = el('section', { class: 'panel', 'aria-labelledby': 'pv-reset-title' }, [
      el('h2', { class: 'pv-title', id: 'pv-reset-title', text: '数据重置' }),
      resetBody,
    ]);

    root.appendChild(
      el('div', { class: 'progress-view stack' }, [overviewPanel, barsPanel, listPanel, legendPanel, resetPanel])
    );

    /* --- 行为 --- */
    function currentStats() {
      if (level === 'all') return store.stats(null, totals || undefined);
      return store.stats(level, totals ? totals[level] : undefined);
    }

    function renderBars() {
      bars.innerHTML = '';
      const list = level === 'all' ? LEVELS.slice() : [level];
      for (let i = 0; i < list.length; i++) {
        const lv = list[i];
        const total = totals && isFinite(Number(totals[lv])) ? Math.max(0, Math.round(Number(totals[lv]))) : 0;
        const st = store.stats(lv, total);
        const b = bucketOf(st);
        const pct = stackPercents({ mastered: b.mastered, learning: b.learning, untouched: b.untouched });

        const segs = [];
        if (pct.mastered > 0) segs.push(el('span', { class: 'pbar__seg pbar__seg--mastered', style: { width: pct.mastered + '%' } }));
        if (pct.learning > 0) segs.push(el('span', { class: 'pbar__seg pbar__seg--learning', style: { width: pct.learning + '%' } }));
        if (pct.untouched > 0) segs.push(el('span', { class: 'pbar__seg pbar__seg--untouched', style: { width: pct.untouched + '%' } }));
        const track = el('div', {
          class: 'pbar__track',
          role: 'img',
          'aria-label': levelText(lv) + '：已掌握 ' + b.mastered + ' 词（' + pct.mastered + '%），学习中 ' + b.learning + ' 词（' +
            pct.learning + '%），未开始 ' + b.untouched + ' 词（' + pct.untouched + '%）',
        }, segs);

        bars.appendChild(el('div', { class: 'pbar' }, [
          el('div', { class: 'pbar__head' }, [
            el('span', { class: 'pbar__name', text: levelText(lv) }),
            el('span', { class: 'pbar__sum', text: total > 0 ? '已学 ' + b.seen + ' / ' + total + ' 词' : '已学 ' + b.seen + ' 词' }),
          ]),
          track,
          el('div', { class: 'pbar__nums' }, [
            el('span', { class: 'pbar__num pbar__num--mastered', text: '已掌握 ' + b.mastered + ' · ' + pct.mastered + '%' }),
            el('span', { class: 'pbar__num pbar__num--learning', text: '学习中 ' + b.learning + ' · ' + pct.learning + '%' }),
            el('span', { class: 'pbar__num pbar__num--untouched', text: '未开始 ' + b.untouched + ' · ' + pct.untouched + '%' }),
          ]),
        ]));
      }
      if (!bars.childNodes.length) bars.appendChild(emptyState('暂无级别数据', '词库清单不可用时无法显示分布。'));
    }

    function learnedRows() {
      let recs = {};
      try {
        recs = store.exportAll().recs || {};
      } catch (e) {
        recs = {};
      }
      const keys = Object.keys(recs);
      const rows = [];
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const parts = splitKey(key);
        if (level !== 'all' && parts.level !== level) continue;
        const r = recs[key] || {};
        if (!(Number(r.seen) > 0)) continue;
        rows.push(progressRow({
          key: key,
          word: parts.level ? bank.word(parts.level, key) : null,
          rec: r,
          progress: progressFromRec(r),
          last: r.last,
        }));
      }
      return rows;
    }

    function rowNode(row) {
      const cells = [];
      for (let i = 1; i <= BOX_MAX; i++) {
        let cls = 'pw-box__cell';
        if (i <= row.box) cls += row.box >= MASTERED_BOX ? ' is-mastered' : ' is-on';
        cells.push(el('span', { class: cls }));
      }
      const kids = [
        el('div', { class: 'pw-row__main' }, [
          el('span', { class: 'pw-row__word', text: row.word }),
          el('span', { class: levelChipClass(row.level), text: levelText(row.level) }),
          row.ipa ? el('span', { class: 'pw-row__ipa', text: '[' + row.ipa + ']' }) : null,
          el('span', { class: 'pw-row__state pw-row__state--' + row.state, text: STATE_LABEL[row.state] || row.state }),
        ]),
      ];
      if (row.meanings.length) kids.push(el('p', { class: 'pw-row__mean', text: row.meanings.join('；') }));
      kids.push(el('div', { class: 'pw-row__foot' }, [
        el('span', { class: 'pw-box', role: 'img', 'aria-label': '掌握度 ' + row.mastery + '%，box ' + row.box + '/' + BOX_MAX }, cells),
        el('span', { class: 'pw-row__box', text: row.mastery + '% · box ' + row.box + '/' + BOX_MAX }),
        el('span', { class: 'spacer' }),
        el('span', { class: 'pw-row__last', text: row.last ? '最近 ' + fmtDay(row.last) : '' }),
      ]));
      return el('li', { class: 'pw-row' }, kids);
    }

    function renderList() {
      const rows = rowsCache;
      const st = curStats || store.stats(null, undefined);
      const filtered = filterRows(rows, query);
      const sorted = sortLearned(filtered, sortKey, sortDir);
      const parts = [];
      parts.push('已学 ' + rows.length + ' 词');
      if (st.total > 0) parts.push('未学 ' + bucketOf(st).untouched + ' 词');
      if (query) parts.push('匹配 ' + filtered.length + ' 条');
      listInfo.textContent = parts.join(' · ');

      listBody.innerHTML = '';
      if (!rows.length) {
        listBody.appendChild(emptyState('还没有学习记录', '去「翻卡」或「小测」学几个词，这里会显示每个词的掌握程度。'));
        return;
      }
      if (!filtered.length) {
        listBody.appendChild(emptyState('没有匹配的词', '换个关键词试试，或清空搜索框。'));
        return;
      }
      const shown = sorted.slice(0, LIST_LIMIT);
      const items = [];
      for (let i = 0; i < shown.length; i++) items.push(rowNode(shown[i]));
      listBody.appendChild(el('ul', { class: 'pw-list' }, items));
      if (sorted.length > shown.length) {
        listBody.appendChild(el('p', { class: 'pv-hint', text: '仅列出前 ' + LIST_LIMIT + ' 条（共 ' + sorted.length + ' 条），用搜索或排序缩小范围。' }));
      }
    }

    function loadLevel(lv) {
      try {
        return bank.load(lv).catch(function () { failedLevels.add(lv); return null; });
      } catch (e) {
        failedLevels.add(lv);
        return Promise.resolve(null);
      }
    }

    function refreshList() {
      rowsCache = learnedRows();
      const levels = [];
      for (let i = 0; i < LEVELS.length; i++) {
        const lv = LEVELS[i];
        if (!bank.loaded(lv) && !failedLevels.has(lv)) levels.push(lv);
      }
      if (!levels.length) {
        renderList();
        return;
      }
      const token = ++tick;
      Promise.all(levels.map(loadLevel)).then(function () {
        if (disposed || token !== tick) return;
        rowsCache = learnedRows();
        renderList();
      });
    }

    function refresh() {
      if (disposed) return;
      const st = currentStats();
      curStats = st;
      const b = bucketOf(st);
      sSeen.num.textContent = String(b.seen);
      sMastered.num.textContent = String(b.mastered);
      sLearning.num.textContent = String(b.learning);
      sUntouched.num.textContent = String(b.untouched);
      sAcc.num.textContent = fmtPct(st.accuracy || 0);
      renderBars();
      refreshList();
    }

    function renderReset() {
      resetBody.innerHTML = '';
      resetBody.appendChild(el('p', { class: 'pv-desc', text: '会清空本地保存的全部学习记录（掌握度、今日计划、错词本）。词库文件本身不受影响。' }));
      if (!askReset) {
        resetBody.appendChild(el('button', {
          class: 'btn btn--danger pv-reset__btn',
          type: 'button',
          onClick: function () { askReset = true; renderReset(); },
        }, '重置全部学习数据'));
        return;
      }
      resetBody.appendChild(el('p', { class: 'pv-warn', role: 'alert', text: '确认清空全部学习数据？此操作不可撤销。' }));
      resetBody.appendChild(el('div', { class: 'row pv-reset__row' }, [
        el('button', { class: 'btn btn--danger', type: 'button', onClick: doReset }, '确认重置'),
        el('button', { class: 'btn btn--ghost', type: 'button', onClick: function () { askReset = false; renderReset(); } }, '取消'),
      ]));
    }

    function doReset() {
      askReset = false;
      store.reset();
      renderReset();
      toast('已重置全部学习数据', 'ok');
      refresh();
    }

    levelSelect.addEventListener('change', function () {
      level = levelSelect.value === 'cet4' || levelSelect.value === 'cet6' ? levelSelect.value : 'all';
      refresh();
    });

    sortSelect.addEventListener('change', function () {
      const raw = String(sortSelect.value || '');
      const cut = raw.indexOf(':');
      sortKey = cut > 0 ? raw.slice(0, cut) : 'mastery';
      sortDir = cut > 0 ? raw.slice(cut + 1) : 'asc';
      renderList();
    });

    searchInput.addEventListener('input', function () {
      query = searchInput.value;
      renderList();
    });

    function initTotals() {
      let task;
      try {
        task = bank.manifest();
      } catch (e) {
        totals = null;
        return Promise.resolve();
      }
      return task.then(function (m) {
        const next = {};
        const levels = (m && m.levels) || {};
        const ks = Object.keys(levels);
        for (let i = 0; i < ks.length; i++) {
          const n = Number(levels[ks[i]] && levels[ks[i]].count);
          if (isFinite(n) && n > 0) next[ks[i]] = Math.round(n);
        }
        totals = Object.keys(next).length ? next : null;
      }).catch(function () {
        totals = null;
      });
    }

    const unwatch = store.subscribe(function () {
      askReset = false;
      renderReset();
      refresh();
    });

    renderReset();
    refresh();
    void initTotals().then(function () {
      if (!disposed) refresh();
    });

    return function cleanup() {
      disposed = true;
      unwatch();
    };
  },
};

export default route;
