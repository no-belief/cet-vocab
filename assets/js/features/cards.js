/* assets/js/features/cards.js — 翻卡记忆（owner: S3）
 * 顶层只有 import 与 const：DOM / localStorage 一律推迟到 route.mount 内部。
 * 音标与例句格式化、批量掌握度派生复用 browse.js 的具名导出（单向依赖，无循环）。
 */
import { bank } from '../core/bank.js';
import { store } from '../core/store.js';
import { el, shuffle, fmtPct, emptyState } from '../core/util.js';
import { ipaText, formatExample, stateMapOf, levelFromSettings } from './browse.js';

const DECK_LIMIT = 60;
const RATE_DELAY_MS = 260;

const LEVELS = [
  { value: 'cet4', label: '四级' },
  { value: 'cet6', label: '六级' },
];

const SCOPES = [
  { value: 'today', label: '今日未学' },
  { value: 'new', label: '未学' },
  { value: 'learning', label: '学习中' },
  { value: 'random', label: '随机' },
];

/* ================= 纯逻辑（Node 可直接 import 测试） ================= */

/**
 * buildDeck(items, { scope, states, todayKeys, limit })
 * scope: 'today'（未掌握，今日未学优先）| 'new' | 'learning' | 'random'（未掌握随机）
 * states: { key: 'new'|'learning'|'mastered' }；todayKeys: Set|Array of key
 * limit: 牌堆上限（默认 DECK_LIMIT，0 = 不限）
 */
export function buildDeck(items, opts) {
  const o = opts || {};
  const scope = o.scope === 'new' || o.scope === 'learning' || o.scope === 'random' ? o.scope : 'today';
  const states = o.states && typeof o.states === 'object' ? o.states : {};
  const todayKeys =
    o.todayKeys instanceof Set ? o.todayKeys : new Set(Array.isArray(o.todayKeys) ? o.todayKeys : []);
  const limit = o.limit === undefined ? DECK_LIMIT : Math.max(0, Math.floor(Number(o.limit) || 0));
  const list = Array.isArray(items) ? items : [];

  const stateOf = function (it) {
    return (it && states[it.key]) || 'new';
  };

  const pool = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it) continue;
    const st = stateOf(it);
    if (scope === 'new') {
      if (st !== 'new') continue;
    } else if (scope === 'learning') {
      if (st !== 'learning') continue;
    } else if (st === 'mastered') {
      continue; // 'today' / 'random' 只取未掌握
    }
    pool.push(it);
  }

  let ordered;
  if (scope === 'today') {
    const fresh = [];
    const done = [];
    for (let i = 0; i < pool.length; i++) {
      if (todayKeys.has(pool[i].key)) done.push(pool[i]);
      else fresh.push(pool[i]);
    }
    ordered = shuffle(fresh).concat(shuffle(done));
  } else {
    ordered = shuffle(pool);
  }
  return limit > 0 ? ordered.slice(0, limit) : ordered;
}

/** 本次会话评价结果统计：results 可为 { key: boolean } 或 [{ key, correct }] */
export function deckStats(results) {
  const src = results || {};
  const values = Array.isArray(src)
    ? src.map(function (r) {
        return r && typeof r === 'object' ? r.correct : r;
      })
    : Object.keys(src).map(function (k) {
        return src[k];
      });
  let known = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const ok = v && typeof v === 'object' ? !!v.correct : !!v;
    if (ok) known += 1;
  }
  const total = values.length;
  const unknown = total - known;
  return { known: known, unknown: unknown, total: total, accuracy: total ? known / total : 0 };
}

export function progressText(index, total, rated) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const ratedNum = Math.max(0, Math.floor(Number(rated) || 0));
  if (!t) return '牌堆为空';
  const i = Math.min(t, Math.max(1, Math.floor(Number(index) || 0) + 1));
  return '第 ' + i + ' / ' + t + ' 张 · 本次已评价 ' + ratedNum + ' 个';
}

export function progressPercent(index, total) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  if (!t) return 0;
  const done = Math.min(t, Math.max(1, Math.floor(Number(index) || 0) + 1));
  return Math.round((done / t) * 100);
}

/* ================= DOM 装配 ================= */

function statCell(label, value) {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'stat__num', text: String(value) }),
    el('span', { class: 'stat__label', text: label }),
  ]);
}

export const route = {
  name: 'cards',
  title: '翻卡记忆',

  mount(root) {
    const doc = typeof document === 'undefined' ? null : document;
    const state = {
      disposed: false,
      level: levelFromSettings(store.settings()),
      scope: 'today',
      deck: [],
      index: 0,
      results: {},
      flipped: false,
      finished: false,
      pending: null,
      requestId: 0,
    };

    /* ---- 工具栏 ---- */
    const levelBtns = LEVELS.map(function (lv) {
      const btn = el('button', {
        type: 'button',
        class: 'btn btn--sm cards__level',
        dataset: { level: lv.value },
        'aria-pressed': 'false',
        text: lv.label,
      });
      btn.addEventListener('click', function () {
        setLevel(lv.value);
      });
      return btn;
    });

    const scopeSelect = el(
      'select',
      { class: 'select cards__scope', 'aria-label': '卡组范围' },
      SCOPES.map(function (o) {
        return el('option', { value: o.value, text: o.label });
      })
    );

    const shuffleBtn = el('button', { type: 'button', class: 'btn btn--sm cards__shuffle', text: '重新洗牌' });

    const bar = el('div', { class: 'panel cards__bar' }, [
      el('div', { class: 'row cards__bar-row' }, [
        el('div', { class: 'row cards__levels', role: 'group', 'aria-label': '词库级别' }, levelBtns),
        el('span', { class: 'spacer' }),
        el('div', { class: 'cards__scope-wrap' }, scopeSelect),
        shuffleBtn,
      ]),
    ]);

    /* ---- 进度 ---- */
    const barFill = el('span', { class: 'progress__bar' });
    const progressWrap = el('div', { class: 'progress cards__progress-bar' }, barFill);
    const metaEl = el('p', { class: 'cards__meta', 'aria-live': 'polite', text: '正在准备卡片…' });
    const progressPanel = el('div', { class: 'cards__progress' }, [progressWrap, metaEl]);

    /* ---- 卡片 ---- */
    const frontFace = el('div', { class: 'flip-card__face flip-card__face--front' });
    const backFace = el('div', { class: 'flip-card__face flip-card__face--back' });
    const inner = el('div', { class: 'flip-card__inner' }, [frontFace, backFace]);
    const flipBtn = el(
      'button',
      { type: 'button', class: 'flip-card', 'aria-pressed': 'false', 'aria-label': '翻转卡片看释义' },
      inner
    );

    const prevBtn = el('button', { type: 'button', class: 'btn btn--sm cards__prev', text: '上一张' });
    const unknownBtn = el('button', { type: 'button', class: 'btn cards__unknown' }, [
      el('span', { text: '不认识' }),
      el('span', { class: 'cards__key', text: 'K / 2' }),
    ]);
    const knownBtn = el('button', { type: 'button', class: 'btn btn--primary cards__known' }, [
      el('span', { text: '认识' }),
      el('span', { class: 'cards__key', text: 'J / 1' }),
    ]);
    const actions = el('div', { class: 'cards__actions' }, [prevBtn, unknownBtn, knownBtn]);
    const stageEl = el('div', { class: 'cards__stage' }, [flipBtn, actions]);

    /* ---- 结束总结 ---- */
    const doneTitle = el('p', { class: 'cards__done-title', text: '这一组看完了' });
    const doneDesc = el('p', { class: 'cards__done-desc', text: '' });
    const doneStats = el('div', { class: 'stat-grid cards__done-stats' });
    const againBtn = el('button', { type: 'button', class: 'btn btn--primary cards__again', text: '再来一组' });
    const doneEl = el('div', { class: 'panel cards__done' }, [doneTitle, doneDesc, doneStats, againBtn]);
    doneEl.hidden = true;

    const emptyWrap = el('div', { class: 'cards__empty' });
    emptyWrap.hidden = true;

    root.appendChild(el('section', { class: 'stack cards' }, [bar, progressPanel, emptyWrap, stageEl, doneEl]));

    /* ---- 行为 ---- */
    function syncLevelButtons() {
      for (let i = 0; i < levelBtns.length; i++) {
        const on = levelBtns[i].dataset.level === state.level;
        levelBtns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        levelBtns[i].className = 'btn btn--sm cards__level' + (on ? ' is-active' : '');
      }
    }

    function syncMeta() {
      const rated = Object.keys(state.results).length;
      metaEl.textContent = progressText(state.index, state.deck.length, rated);
      barFill.style.width = progressPercent(state.index, state.deck.length) + '%';
    }

    function setFlipped(on) {
      state.flipped = !!on;
      flipBtn.className = 'flip-card' + (on ? ' is-flipped' : '');
      flipBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      flipBtn.setAttribute('aria-label', on ? '收回正面' : '翻转卡片看释义');
    }

    function toggleFlip() {
      if (state.finished || !state.deck.length) return;
      setFlipped(!state.flipped);
    }

    function clearPending() {
      if (state.pending) {
        clearTimeout(state.pending);
        state.pending = null;
      }
    }

    function renderCard() {
      const item = state.deck[state.index];
      if (!item) {
        renderDone();
        return;
      }
      setFlipped(false);

      frontFace.innerHTML = '';
      frontFace.appendChild(el('span', { class: 'cards__word', text: String(item.word || '') }));
      const ipa = ipaText(item.ipa);
      if (ipa) frontFace.appendChild(el('span', { class: 'cards__ipa', text: ipa }));
      frontFace.appendChild(el('p', { class: 'cards__hint', text: '点击卡片或按空格翻面' }));

      backFace.innerHTML = '';
      backFace.appendChild(el('p', { class: 'cards__word cards__word--back', text: String(item.word || '') }));
      const meanings = (Array.isArray(item.meanings) ? item.meanings : []).slice(0, 3);
      backFace.appendChild(
        el(
          'ul',
          { class: 'cards__meanings' },
          meanings.map(function (m) {
            return el('li', { class: 'cards__meaning', text: String(m == null ? '' : m) });
          })
        )
      );
      const ex = formatExample(item.example);
      if (ex.empty) {
        backFace.appendChild(el('p', { class: 'cards__noex', text: ex.en }));
      } else {
        const kids = [];
        if (ex.en) kids.push(el('p', { class: 'cards__ex-en', lang: 'en', text: ex.en }));
        if (ex.zh) kids.push(el('p', { class: 'cards__ex-zh', text: ex.zh }));
        backFace.appendChild(el('div', { class: 'cards__example' }, kids));
      }

      state.finished = false;
      stageEl.hidden = false;
      doneEl.hidden = true;
      emptyWrap.hidden = true;
      syncMeta();
    }

    function renderDone() {
      clearPending();
      state.finished = true;
      const st = deckStats(state.results);
      doneTitle.textContent = st.total ? '这一组看完了' : '这一组没有可评价的词';
      doneDesc.textContent = st.total
        ? '本次认识 ' + st.known + ' 个，不认识 ' + st.unknown + ' 个。'
        : '试试换个范围，或者先翻几张卡片。';
      doneStats.innerHTML = '';
      doneStats.appendChild(statCell('认识', st.known));
      doneStats.appendChild(statCell('不认识', st.unknown));
      doneStats.appendChild(statCell('正确率', fmtPct(st.accuracy)));
      stageEl.hidden = true;
      doneEl.hidden = false;
      emptyWrap.hidden = true;
      metaEl.textContent = '第 ' + state.deck.length + ' / ' + state.deck.length + ' 张 · 本次已评价 ' + Object.keys(state.results).length + ' 个';
      barFill.style.width = state.deck.length ? '100%' : '0%';
    }

    function go(index) {
      if (state.disposed) return;
      clearPending();
      const total = state.deck.length;
      if (index >= total) {
        renderDone();
        return;
      }
      state.index = Math.max(0, Math.min(total - 1, index));
      renderCard();
    }

    function rate(correct) {
      if (state.disposed || state.finished || state.pending) return;
      const item = state.deck[state.index];
      if (!item) return;
      try {
        store.markSeen(item.key, !!correct);
      } catch (e) { /* 写入失败不阻断翻卡 */ }
      state.results[item.key] = !!correct;
      setFlipped(false);
      syncMeta();
      state.pending = setTimeout(function () {
        state.pending = null;
        if (state.disposed) return;
        go(state.index + 1);
      }, RATE_DELAY_MS);
    }

    function showEmpty(title, desc) {
      emptyWrap.innerHTML = '';
      emptyWrap.appendChild(emptyState(title, desc));
      emptyWrap.hidden = false;
      stageEl.hidden = true;
      doneEl.hidden = true;
      metaEl.textContent = '牌堆为空';
      barFill.style.width = '0%';
    }

    function startSession() {
      const my = (state.requestId += 1);
      clearPending();
      state.deck = [];
      state.index = 0;
      state.results = {};
      state.finished = false;
      stageEl.hidden = true;
      doneEl.hidden = true;
      emptyWrap.hidden = true;
      metaEl.textContent = '正在准备卡片…';
      barFill.style.width = '0%';
      bank
        .items([state.level])
        .then(function (items) {
          if (state.disposed || my !== state.requestId) return null;
          let states = {};
          let todayKeys = new Set();
          try {
            states = stateMapOf(store.exportAll().recs);
          } catch (e) {
            states = {};
          }
          try {
            todayKeys = new Set(store.daily().doneKeys || []);
          } catch (e) {
            todayKeys = new Set();
          }
          return buildDeck(items, { scope: state.scope, states: states, todayKeys: todayKeys, limit: DECK_LIMIT });
        })
        .then(function (deck) {
          if (!deck || state.disposed || my !== state.requestId) return;
          if (!deck.length) {
            showEmpty('这个范围暂时没有词', '试试「随机」范围、切换级别，或先去「词库浏览」翻一翻。');
            return;
          }
          state.deck = deck;
          state.index = 0;
          renderCard();
        })
        .catch(function () {
          if (state.disposed || my !== state.requestId) return;
          showEmpty('卡片暂时不可用', '词库加载失败，请确认通过本地 http 服务访问页面后刷新重试。');
        });
    }

    function setLevel(next) {
      if (next === state.level || state.disposed) return;
      state.level = next;
      syncLevelButtons();
      try {
        store.updateSettings({ level: next });
      } catch (e) { /* ignore */ }
      startSession();
    }

    function onKeyDown(ev) {
      if (state.disposed || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target;
      const tag = t && t.tagName ? String(t.tagName).toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const key = ev.key;
      if (key === 'ArrowLeft') {
        ev.preventDefault();
        go(state.index - 1);
      } else if (key === 'ArrowRight') {
        ev.preventDefault();
        go(state.index + 1);
      } else if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
        if (tag === 'BUTTON') return; // 焦点在按钮上时交给原生 click，避免双触发
        ev.preventDefault();
        toggleFlip();
      } else if (key === 'j' || key === 'J' || key === '1') {
        ev.preventDefault();
        rate(true);
      } else if (key === 'k' || key === 'K' || key === '2') {
        ev.preventDefault();
        rate(false);
      }
    }

    flipBtn.addEventListener('click', function () {
      toggleFlip();
    });
    prevBtn.addEventListener('click', function () {
      go(state.index - 1);
    });
    knownBtn.addEventListener('click', function () {
      rate(true);
    });
    unknownBtn.addEventListener('click', function () {
      rate(false);
    });
    againBtn.addEventListener('click', function () {
      startSession();
    });
    shuffleBtn.addEventListener('click', function () {
      startSession();
    });
    scopeSelect.addEventListener('change', function () {
      const v = String(scopeSelect.value || 'today');
      state.scope = v === 'new' || v === 'learning' || v === 'random' ? v : 'today';
      startSession();
    });
    if (doc) doc.addEventListener('keydown', onKeyDown);

    syncLevelButtons();
    startSession();

    return function cleanup() {
      state.disposed = true;
      state.requestId += 1;
      clearPending();
      if (doc) doc.removeEventListener('keydown', onKeyDown);
    };
  },
};

export default route;
