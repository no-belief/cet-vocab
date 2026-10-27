/* assets/js/features/plan.js — 每日学习计划（owner: S4）
 * 顶层只做 import 与 const；纯逻辑用具名导出的函数，便于 scripts/selftest-plan-progress.mjs 在 Node 里断言。
 */
import { bank } from '../core/bank.js';
import { store } from '../core/store.js';
import { router } from '../core/router.js';
import { el, emptyState, fmtPct, toast } from '../core/util.js';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const QUICK_GOALS = [10, 20, 30, 50];
const LEVEL_TEXT = { cet4: '四级', cet6: '六级' };

export const GOAL_MIN = 1;
export const GOAL_MAX = 200;
export const DEFAULT_GOAL = 20;
export const LIST_LIMIT = 30;

/* ---------- 纯逻辑（Node 可测） ---------- */

function toInt(v, def) {
  const n = Math.round(Number(v));
  return isFinite(n) ? n : def;
}

/**
 * 把输入框里的原始值收敛成合法的每日学习量。
 * 返回 { value, ok, message }：ok=false 表示输入非法或被夹取，message 用于友好提示。
 */
export function clampGoal(raw, fallback) {
  const fb = Math.min(GOAL_MAX, Math.max(GOAL_MIN, toInt(fallback, DEFAULT_GOAL)));
  const text = raw == null ? '' : String(raw).trim();
  if (!text) return { value: fb, ok: false, message: '请输入 ' + GOAL_MIN + '–' + GOAL_MAX + ' 之间的每日学习量' };
  const n = Number(text);
  if (!isFinite(n)) return { value: fb, ok: false, message: '每日学习量需要填数字（' + GOAL_MIN + '–' + GOAL_MAX + '）' };
  const v = Math.round(n);
  if (v < GOAL_MIN) return { value: GOAL_MIN, ok: false, message: '每日学习量最小为 ' + GOAL_MIN + '，已按最小值保存' };
  if (v > GOAL_MAX) return { value: GOAL_MAX, ok: false, message: '每日学习量最大为 ' + GOAL_MAX + '，已按最大值保存' };
  return { value: v, ok: true, message: '' };
}

/** 今日完成度：pct 用于进度条宽度（封顶 100），ratio 给 fmtPct 展示。 */
export function goalProgress(done, goal) {
  const g = Math.max(1, toInt(goal, DEFAULT_GOAL));
  const d = Math.max(0, toInt(done, 0));
  const ratio = d / g;
  return {
    done: d,
    goal: g,
    remaining: Math.max(0, g - d),
    extra: Math.max(0, d - g),
    ratio: ratio > 1 ? 1 : ratio,
    pct: Math.min(100, Math.round(ratio * 100)),
    reached: d >= g,
  };
}

/** 中文日期标签："2025年3月10日 周一"。 */
export function dayLabel(date) {
  const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
  if (!isFinite(d.getTime())) return '';
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()];
}

/** "cet4:cancel" → {level:'cet4', word:'cancel'}；无前缀时 level 为空串。 */
export function splitKey(key) {
  const s = key == null ? '' : String(key);
  const i = s.indexOf(':');
  if (i <= 0) return { level: '', word: s };
  return { level: s.slice(0, i), word: s.slice(i + 1) };
}

/** 超过 limit 条时折叠：{ shown, hidden, total, truncated }。 */
export function foldRows(rows, expanded, limit) {
  const list = Array.isArray(rows) ? rows : [];
  const max = Math.max(1, toInt(limit, LIST_LIMIT));
  if (expanded || list.length <= max) {
    return { shown: list.slice(), hidden: 0, total: list.length, truncated: false };
  }
  return { shown: list.slice(0, max), hidden: list.length - max, total: list.length, truncated: true };
}

/** 达标后的轻量庆祝文案；未达标返回空串。 */
export function celebrationText(done, goal) {
  const p = goalProgress(done, goal);
  if (!p.reached) return '';
  if (p.extra > 0) return '目标已超额完成（今日 ' + p.done + ' 词），稳！';
  return '今日目标达成，休息一下或再加几个词都行。';
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
  name: 'plan',
  title: '今日计划',
  mount: function mount(root) {
    let expanded = false;
    let disposed = false;
    let wordsToken = 0;
    const failedLevels = new Set();

    const daily0 = store.daily();

    /* --- 设置区 --- */
    const goalInput = el('input', {
      class: 'input plan-goal__input',
      id: 'plan-goal-input',
      type: 'number',
      min: String(GOAL_MIN),
      max: String(GOAL_MAX),
      step: '1',
      inputmode: 'numeric',
      value: String(daily0.goal),
      'aria-describedby': 'plan-goal-hint',
    });
    const hint = el('p', { class: 'plan__hint', id: 'plan-goal-hint', role: 'status', 'aria-live': 'polite' });

    const quickButtons = QUICK_GOALS.map(function (n) {
      return el(
        'button',
        {
          class: 'btn btn--sm',
          type: 'button',
          'aria-label': '把每日学习量设为 ' + n + ' 个词',
          onClick: function () { applyGoal(String(n), true); },
        },
        String(n)
      );
    });

    const goalPanel = el('section', { class: 'panel plan-goal', 'aria-labelledby': 'plan-goal-title' }, [
      el('div', { class: 'plan__head' }, [
        el('h2', { class: 'plan__title', id: 'plan-goal-title', text: '每日学习量' }),
        el('span', { class: 'chip', text: GOAL_MIN + '–' + GOAL_MAX + ' 词' }),
      ]),
      el('p', { class: 'plan__desc', text: '设定每天想学多少个词，今日进度与顶栏都会按这个目标统计。' }),
      el('div', { class: 'plan-goal__row' }, [
        el('label', { class: 'plan__label', for: 'plan-goal-input', text: '每天学习' }),
        goalInput,
        el('button', { class: 'btn btn--primary', type: 'button', onClick: function () { applyGoal(goalInput.value, false); } }, '保存'),
      ]),
      el('div', { class: 'row plan-goal__quick' }, quickButtons),
      hint,
    ]);

    /* --- 今日任务卡 --- */
    const dateLine = el('p', { class: 'plan-today__date' });
    const countLine = el('p', { class: 'plan-today__count' });
    const bar = el('span', { class: 'progress__bar' });
    const progressEl = el('div', {
      class: 'progress plan-today__progress',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-label': '今日学习进度',
    }, [bar]);
    const metaLine = el('p', { class: 'plan-today__meta' });
    const cheerEl = el('p', { class: 'plan-today__cheer', role: 'status', 'aria-live': 'polite', hidden: true });

    const todayPanel = el('section', { class: 'panel plan-today', 'aria-labelledby': 'plan-today-title' }, [
      el('div', { class: 'plan__head' }, [
        el('h2', { class: 'plan__title', id: 'plan-today-title', text: '今日任务' }),
        dateLine,
      ]),
      countLine,
      progressEl,
      metaLine,
      cheerEl,
    ]);

    /* --- 任务清单 --- */
    const listTitle = el('h2', { class: 'plan__title', id: 'plan-list-title' });
    const listBody = el('div', { class: 'plan-list' });
    const listPanel = el('section', { class: 'panel plan-tasks', 'aria-labelledby': 'plan-list-title' }, [listTitle, listBody]);

    /* --- 入口 --- */
    const actions = el('div', { class: 'plan-actions' }, [
      el('button', { class: 'btn btn--primary plan-cta', type: 'button', onClick: function () { router.go('cards'); } }, '开始今日学习'),
      el('div', { class: 'row plan-links' }, [
        el('button', { class: 'btn btn--ghost', type: 'button', onClick: function () { router.go('quiz'); } }, '去测试'),
        el('button', { class: 'btn btn--ghost', type: 'button', onClick: function () { router.go('wrong'); } }, '回顾错词'),
      ]),
    ]);

    root.appendChild(el('div', { class: 'plan stack' }, [goalPanel, todayPanel, listPanel, actions]));

    /* --- 行为 --- */
    function applyGoal(raw, fromQuick) {
      const r = clampGoal(raw, store.daily().goal);
      hint.textContent = r.message;
      hint.classList.toggle('plan__hint--warn', !r.ok);
      goalInput.value = String(r.value);
      store.setDailyGoal(r.value);
      if (r.ok || fromQuick) toast('每日学习量已设为 ' + r.value + ' 词', 'ok');
      else toast(r.message, 'err');
      refresh();
    }

    goalInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        applyGoal(goalInput.value, false);
      }
    });

    function wordOf(key) {
      const parts = splitKey(key);
      return parts.level ? bank.word(parts.level, key) : null;
    }

    function wordRow(key) {
      const parts = splitKey(key);
      const w = wordOf(key);
      const word = w && typeof w.word === 'string' && w.word ? w.word : parts.word;
      const ipa = w && typeof w.ipa === 'string' && w.ipa ? w.ipa : (w && typeof w.ipaUs === 'string' ? w.ipaUs : '');
      const meanings = w && Array.isArray(w.meanings) ? w.meanings : [];
      const example = w && w.example && typeof w.example.en === 'string' && w.example.en ? w.example.en : '';
      const pos = w && w.pos ? String(w.pos) : '';

      const head = [
        el('span', { class: 'plan-word__word', text: word || key }),
        el('span', { class: levelChipClass(parts.level), text: levelText(parts.level) }),
      ];
      if (ipa) head.push(el('span', { class: 'plan-word__ipa', text: '[' + ipa + ']' }));
      if (meanings.length) head.push(el('span', { class: 'plan-word__mean', text: meanings[0] }));

      const canExpand = !!(example || meanings.length > 1);
      if (!canExpand) {
        return el('div', { class: 'plan-word' }, [el('div', { class: 'plan-word__head plan-word__head--static' }, head)]);
      }

      const detailKids = [];
      if (pos) detailKids.push(el('span', { class: 'plan-word__pos', text: pos }));
      if (meanings.length > 1) detailKids.push(el('span', { text: '释义：' + meanings.join('；') }));
      if (example) detailKids.push(el('p', { class: 'plan-word__example', text: example }));
      const detail = el('div', { class: 'plan-word__detail', hidden: true }, detailKids);

      const caret = el('span', { class: 'plan-word__caret', 'aria-hidden': 'true', text: '＋' });
      const btn = el('button', { class: 'plan-word__head', type: 'button', 'aria-expanded': 'false' }, head.concat([caret]));
      btn.addEventListener('click', function () {
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        detail.hidden = open;
        caret.textContent = open ? '＋' : '－';
      });
      return el('div', { class: 'plan-word' }, [btn, detail]);
    }

    function renderList(d) {
      const keys = d.doneKeys.slice().reverse();
      const total = keys.length;
      listTitle.textContent = total ? '今日已学（' + total + ' 个词）' : '今日已学';
      listBody.innerHTML = '';
      if (!total) {
        listBody.appendChild(emptyState('今天还没有学习的词', '点下面的「开始今日学习」翻几张卡，学过的词会自动记在这里。'));
        return;
      }
      const fold = foldRows(keys, expanded, LIST_LIMIT);
      for (let i = 0; i < fold.shown.length; i++) listBody.appendChild(wordRow(fold.shown[i]));
      if (total > LIST_LIMIT) {
        listBody.appendChild(
          el(
            'button',
            {
              class: 'btn btn--ghost plan-list__more',
              type: 'button',
              'aria-expanded': expanded ? 'true' : 'false',
              onClick: function () {
                expanded = !expanded;
                renderList(store.daily());
              },
            },
            expanded ? '收起' : '展开全部（还有 ' + (total - LIST_LIMIT) + ' 个）'
          )
        );
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

    function refreshList(d) {
      renderList(d);
      const levels = [];
      for (let i = 0; i < d.doneKeys.length; i++) {
        const lv = splitKey(d.doneKeys[i]).level;
        if (lv && levels.indexOf(lv) < 0 && !bank.loaded(lv) && !failedLevels.has(lv)) levels.push(lv);
      }
      if (!levels.length) return;
      const token = ++wordsToken;
      Promise.all(levels.map(loadLevel)).then(function () {
        if (disposed || token !== wordsToken) return;
        renderList(store.daily());
      });
    }

    function refresh() {
      if (disposed) return;
      const d = store.daily();
      const p = goalProgress(d.doneCount, d.goal);
      dateLine.textContent = dayLabel(new Date());
      countLine.innerHTML = '';
      countLine.appendChild(el('span', { text: '今日完成 ' }));
      countLine.appendChild(el('strong', { class: 'plan-today__done', text: String(p.done) }));
      countLine.appendChild(el('span', { text: ' / ' + p.goal + ' 词' }));
      bar.style.width = p.pct + '%';
      progressEl.setAttribute('aria-valuenow', String(p.pct));
      progressEl.setAttribute('aria-valuetext', '今日已完成 ' + p.pct + '%');
      metaLine.textContent = p.reached
        ? '完成 ' + fmtPct(p.ratio) + ' · 今日目标已达成'
        : '完成 ' + fmtPct(p.ratio) + ' · 还剩 ' + p.remaining + ' 词';
      const cheer = celebrationText(p.done, p.goal);
      cheerEl.textContent = cheer;
      cheerEl.hidden = !cheer;
      refreshList(d);
    }

    const unwatch = store.subscribe(refresh);
    const onVisible = function () {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') refresh();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

    refresh();

    return function cleanup() {
      disposed = true;
      unwatch();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  },
};

export default route;
