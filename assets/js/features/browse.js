/* assets/js/features/browse.js — 词库浏览（owner: S3）
 * 顶层只有 import 与 const：DOM / localStorage 一律推迟到 route.mount 内部执行，
 * 这样 Node 里 import 本模块即可对纯逻辑做自测。
 */
import { bank } from '../core/bank.js';
import { store } from '../core/store.js';
import { el, debounce, emptyState, createAudioButton } from '../core/util.js';

const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 200;
const NO_EXAMPLE = '暂无例句';

const LEVELS = [
  { value: 'cet4', label: '四级' },
  { value: 'cet6', label: '六级' },
];

const STATE_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'new', label: '未学' },
  { value: 'learning', label: '学习中' },
  { value: 'mastered', label: '已掌握' },
];

/* bank.items 每次都会重建全部词条对象，按级别留一份缓存避免重复映射 */
const itemCache = new Map();

/* ================= 纯逻辑（Node 可直接 import 测试） ================= */

/** 音标展示：空值不加方括号，已带方括号的原样返回 */
export function ipaText(ipa) {
  const raw = String(ipa == null ? '' : ipa).trim();
  if (!raw) return '';
  if (raw.charAt(0) === '[' && raw.charAt(raw.length - 1) === ']') return raw;
  return '[' + raw + ']';
}

/** 例句：缺失/null → { en: '暂无例句', zh: '', empty: true }；不渲染 undefined */
export function formatExample(example) {
  const ex = example && typeof example === 'object' ? example : null;
  const en = ex && typeof ex.en === 'string' ? ex.en.trim() : '';
  const zh = ex && typeof ex.zh === 'string' ? ex.zh.trim() : '';
  if (!en && !zh) return { en: NO_EXAMPLE, zh: '', empty: true };
  return { en: en, zh: zh, empty: false };
}

export function normalizeQuery(raw) {
  return String(raw == null ? '' : raw).trim().toLowerCase();
}

/** 搜索命中：word 子串 或 任一中文释义子串（大小写不敏感） */
export function matchQuery(item, query) {
  const q = normalizeQuery(query);
  if (!q) return true;
  if (!item) return false;
  const word = String(item.word == null ? '' : item.word).toLowerCase();
  if (word.indexOf(q) >= 0) return true;
  const meanings = Array.isArray(item.meanings) ? item.meanings : [];
  for (let i = 0; i < meanings.length; i++) {
    if (String(meanings[i] == null ? '' : meanings[i]).toLowerCase().indexOf(q) >= 0) return true;
  }
  return false;
}

/**
 * opts: { query, state: 'all'|'new'|'learning'|'mastered', stateOf(key) }
 * stateOf 缺省时一切视为 'new'（仅用于测试/降级）。
 */
export function filterWords(items, opts) {
  const o = opts || {};
  const want = o.state && o.state !== 'all' ? String(o.state) : 'all';
  const stateOf = typeof o.stateOf === 'function' ? o.stateOf : null;
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!matchQuery(it, o.query)) continue;
    if (want !== 'all') {
      const st = stateOf ? stateOf(it && it.key) : 'new';
      if (st !== want) continue;
    }
    out.push(it);
  }
  return out;
}

/** 增量渲染的分页窗口：[shown, shown+size) */
export function chunkOf(items, shown, size) {
  const all = Array.isArray(items) ? items : [];
  const total = all.length;
  const step = Math.max(1, Math.floor(Number(size)) || PAGE_SIZE);
  const from = Math.min(total, Math.max(0, Math.floor(Number(shown)) || 0));
  const to = Math.min(total, from + step);
  return { start: from, end: to, items: all.slice(from, to), hasMore: to < total, total: total, loaded: to };
}

/** 「共 N 词 · 已学 M · 已掌握 K」 */
export function statsText(st) {
  const n = function (v) {
    const x = Number(v);
    return isFinite(x) && x > 0 ? String(Math.round(x)) : '0';
  };
  const s = st || {};
  return '共 ' + n(s.total) + ' 词 · 已学 ' + n(s.seen) + ' · 已掌握 ' + n(s.mastered);
}

export function levelFromSettings(settings) {
  return settings && settings.level === 'cet6' ? 'cet6' : 'cet4';
}

/** CONTRACT.md §5 的 state 规则（批量派生用；单卡展示仍走 store.progressOf） */
export function stateOfRec(rec) {
  const r = rec || {};
  const seen = Number(r.seen) || 0;
  const box = Number(r.box) || 0;
  if (seen === 0) return 'new';
  return box >= 4 ? 'mastered' : 'learning';
}

/** recs(object: key -> rec) → { key: 'new'|'learning'|'mastered' } */
export function stateMapOf(recs) {
  const out = {};
  if (!recs || typeof recs !== 'object') return out;
  const keys = Object.keys(recs);
  for (let i = 0; i < keys.length; i++) out[keys[i]] = stateOfRec(recs[keys[i]]);
  return out;
}

/* ================= DOM 装配 ================= */

function loadItems(level) {
  const hit = itemCache.get(level);
  if (hit) return Promise.resolve(hit);
  return bank.items([level]).then(function (items) {
    itemCache.set(level, items);
    return items;
  });
}

function meaningList(meanings) {
  const list = Array.isArray(meanings) ? meanings.slice(0, 3) : [];
  return el(
    'ul',
    { class: 'word-card__meanings' },
    list.map(function (m) {
      return el('li', { class: 'word-card__meaning', text: String(m == null ? '' : m) });
    })
  );
}

function exampleBlock(example) {
  const ex = formatExample(example);
  const kids = [];
  if (ex.empty) {
    kids.push(el('p', { class: 'word-card__noex', text: ex.en }));
  } else {
    if (ex.en) kids.push(el('p', { class: 'word-card__ex-en', lang: 'en', text: ex.en }));
    if (ex.zh) kids.push(el('p', { class: 'word-card__ex-zh', text: ex.zh }));
  }
  return el('div', { class: 'word-card__example' }, kids);
}

/** 单张词条卡（含自管的「例句」展开/收起） */
function wordCard(item) {
  const ipa = ipaText(item && item.ipa);
  const wordText = String(item && item.word != null ? item.word : '');
  const head = el('div', { class: 'word-card__head' }, [
    el('span', { class: 'word-card__word', text: wordText }),
    wordText ? createAudioButton(wordText) : null,
    ipa ? el('span', { class: 'word-card__ipa', text: ipa }) : null,
  ]);
  if (item && item.pos) head.appendChild(el('span', { class: 'chip word-card__pos', text: String(item.pos) }));

  const body = exampleBlock(item && item.example);
  body.hidden = true;

  const toggle = el('button', {
    type: 'button',
    class: 'btn btn--ghost btn--sm word-card__toggle',
    'aria-expanded': 'false',
    text: '例句',
  });
  toggle.addEventListener('click', function () {
    const open = !body.hidden;
    body.hidden = open;
    toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    toggle.textContent = open ? '例句' : '收起例句';
  });

  return el('li', { class: 'panel word-card' }, [head, meaningList(item && item.meanings), toggle, body]);
}

export const route = {
  name: 'browse',
  title: '词库浏览',

  mount(root) {
    const doc = typeof document === 'undefined' ? null : document;
    const state = {
      disposed: false,
      level: levelFromSettings(store.settings()),
      items: [],
      total: 0,
      filtered: [],
      shown: 0,
      query: '',
      filter: 'all',
      requestId: 0,
      states: null,
      unwatch: null,
    };

    /* ---- 工具栏 ---- */
    const statsLine = el('p', { class: 'browse__stats', 'aria-live': 'polite', text: '正在载入词库…' });

    const levelBtns = LEVELS.map(function (lv) {
      const btn = el('button', {
        type: 'button',
        class: 'btn btn--sm browse__level',
        dataset: { level: lv.value },
        'aria-pressed': 'false',
        text: lv.label,
      });
      btn.addEventListener('click', function () {
        setLevel(lv.value);
      });
      return btn;
    });

    const searchInput = el('input', {
      type: 'search',
      class: 'input browse__search',
      placeholder: '搜索单词或中文释义',
      'aria-label': '搜索单词或中文释义',
      autocomplete: 'off',
      spellcheck: 'false',
    });

    const filterSelect = el(
      'select',
      { class: 'select browse__filter', 'aria-label': '按掌握度筛选' },
      STATE_FILTERS.map(function (o) {
        return el('option', { value: o.value, text: o.label });
      })
    );

    const bar = el('div', { class: 'panel browse__bar' }, [
      el('div', { class: 'row browse__bar-row' }, [
        el('div', { class: 'row browse__levels', role: 'group', 'aria-label': '词库级别' }, levelBtns),
        el('span', { class: 'spacer' }),
        el('span', { class: 'browse__tip', text: '单词 / 中文释义都可搜' }),
      ]),
      el('div', { class: 'row browse__bar-row' }, [
        el('div', { class: 'browse__search-wrap' }, searchInput),
        el('div', { class: 'browse__filter-wrap' }, filterSelect),
      ]),
    ]);

    const emptyWrap = el('div', { class: 'browse__empty' });
    emptyWrap.hidden = true;
    const listEl = el('ul', { class: 'browse__list' });

    const moreBtn = el('button', { type: 'button', class: 'btn browse__more-btn', text: '加载更多' });
    const moreWrap = el('div', { class: 'browse__more' }, moreBtn);
    moreWrap.hidden = true;

    root.appendChild(el('section', { class: 'stack browse' }, [statsLine, bar, emptyWrap, listEl, moreWrap]));

    /* ---- 行为 ---- */
    function syncLevelButtons() {
      for (let i = 0; i < levelBtns.length; i++) {
        const on = levelBtns[i].dataset.level === state.level;
        levelBtns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        levelBtns[i].className = 'btn btn--sm browse__level' + (on ? ' is-active' : '');
      }
    }

    function stateOfKey(key) {
      if (!state.states) {
        try {
          state.states = stateMapOf(store.exportAll().recs);
        } catch (e) {
          state.states = {};
        }
      }
      return state.states[key] || 'new';
    }

    function refreshStats() {
      let st = null;
      try {
        st = store.stats(state.level, state.total || state.items.length || 0);
      } catch (e) {
        st = null;
      }
      statsLine.textContent = st ? statsText(st) : '统计暂不可用';
    }

    function showEmpty(title, desc) {
      emptyWrap.innerHTML = '';
      emptyWrap.appendChild(emptyState(title, desc));
      emptyWrap.hidden = false;
    }

    function hideEmpty() {
      emptyWrap.innerHTML = '';
      emptyWrap.hidden = true;
    }

    function renderChunk() {
      const chunk = chunkOf(state.filtered, state.shown, PAGE_SIZE);
      state.shown = chunk.loaded;
      if (chunk.items.length) {
        const frag = doc.createDocumentFragment();
        for (let i = 0; i < chunk.items.length; i++) frag.appendChild(wordCard(chunk.items[i]));
        listEl.appendChild(frag);
      }
      moreWrap.hidden = !chunk.hasMore;
      if (!state.filtered.length) {
        const narrowed = state.query !== '' || state.filter !== 'all';
        showEmpty(narrowed ? '没有匹配的词' : '这个词库里还没有词', narrowed ? '换个关键词，或把「掌握度」切回「全部」再试。' : '可以切换级别看看。');
      } else {
        hideEmpty();
      }
    }

    function applyFilter() {
      state.filtered = filterWords(state.items, { query: state.query, state: state.filter, stateOf: stateOfKey });
      state.shown = 0;
      listEl.innerHTML = '';
      renderChunk();
    }

    function reload() {
      const my = (state.requestId += 1);
      state.items = [];
      state.filtered = [];
      state.shown = 0;
      state.states = null;
      listEl.innerHTML = '';
      moreWrap.hidden = true;
      hideEmpty();
      statsLine.textContent = '正在载入词库…';
      loadItems(state.level)
        .then(function (items) {
          if (state.disposed || my !== state.requestId) return null;
          return bank
            .count(state.level)
            .then(function (n) {
              const total = Number(n);
              return { items: items, total: isFinite(total) && total > 0 ? total : items.length };
            })
            .catch(function () {
              return { items: items, total: items.length };
            });
        })
        .then(function (res) {
          if (!res || state.disposed || my !== state.requestId) return;
          state.items = res.items;
          state.total = res.total;
          refreshStats();
          applyFilter();
        })
        .catch(function () {
          if (state.disposed || my !== state.requestId) return;
          statsLine.textContent = '词库不可用';
          showEmpty('词库加载失败', '请确认通过本地 http 服务访问页面（用 file:// 直接打开无法读取词库），然后刷新重试。');
        });
    }

    function setLevel(next) {
      if (next === state.level || state.disposed) return;
      state.level = next;
      syncLevelButtons();
      try {
        store.updateSettings({ level: next });
      } catch (e) { /* 写入失败不影响浏览 */ }
      reload();
    }

    const applySearch = debounce(function () {
      state.query = normalizeQuery(searchInput.value);
      applyFilter();
    }, SEARCH_DEBOUNCE_MS);

    searchInput.addEventListener('input', applySearch);
    filterSelect.addEventListener('change', function () {
      state.filter = String(filterSelect.value || 'all');
      applyFilter();
    });
    moreBtn.addEventListener('click', function () {
      renderChunk();
    });

    try {
      state.unwatch = store.subscribe(function () {
        state.states = null;
        refreshStats();
      });
    } catch (e) {
      state.unwatch = null;
    }

    syncLevelButtons();
    reload();

    return function cleanup() {
      state.disposed = true;
      state.requestId += 1;
      if (state.unwatch) {
        try { state.unwatch(); } catch (e) { /* ignore */ }
        state.unwatch = null;
      }
    };
  },
};

export default route;
