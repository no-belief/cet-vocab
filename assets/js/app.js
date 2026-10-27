/* app.js — 启动 / 导航 / HUD / 路由注册（owner: S2）
 * feature 模块一律用动态 import 装载；缺失或抛错时渲染 .empty 占位，绝不白屏。
 */
import { bank } from './core/bank.js';
import { store } from './core/store.js';
import { router } from './core/router.js';
import { el, q, emptyState } from './core/util.js';

const ROUTES = [
  { name: 'browse', title: '词库浏览' },
  { name: 'cards', title: '翻卡记忆' },
  { name: 'plan', title: '今日计划' },
  { name: 'quiz', title: '小测' },
  { name: 'wrong', title: '错词本' },
  { name: 'progress', title: '学习进度' },
];

const LOADERS = {
  browse: function () { return import('./features/browse.js'); },
  cards: function () { return import('./features/cards.js'); },
  plan: function () { return import('./features/plan.js'); },
  quiz: function () { return import('./features/quiz.js'); },
  wrong: function () { return import('./features/wrong.js'); },
  progress: function () { return import('./features/progress.js'); },
};

const hudState = { totals: null, totalsLoaded: false };

function mountPending(root, meta) {
  let disposed = false;
  let inner = null;
  const loader = LOADERS[meta.name];
  const fail = function (err) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[app] feature 模块不可用：' + meta.name, err);
    if (disposed) return;
    root.innerHTML = '';
    root.appendChild(
      emptyState(
        '该模块尚未就绪',
        '「' + meta.title + '」（assets/js/features/' + meta.name + '.js）暂时不可用，请稍后刷新，或先切换到其他页面。'
      )
    );
  };
  const task = Promise.resolve()
    .then(function () { return loader(); })
    .then(function (mod) {
      const route = (mod && mod.route) || (mod && mod.default) || null;
      if (!route || typeof route.mount !== 'function') throw new Error('模块未导出 route.mount');
      if (disposed) return null;
      return route.mount(root);
    })
    .then(function (cleanup) {
      if (disposed) {
        if (typeof cleanup === 'function') {
          try { cleanup(); } catch (e) { /* ignore */ }
        }
        return;
      }
      inner = typeof cleanup === 'function' ? cleanup : null;
    })
    .catch(fail);

  void task;
  return function cleanupPending() {
    disposed = true;
    if (typeof inner === 'function') {
      try { inner(); } catch (e) { /* ignore */ }
    }
    inner = null;
  };
}

function buildNav() {
  const nav = q('#app-nav');
  if (!nav) return;
  nav.innerHTML = '';
  for (let i = 0; i < ROUTES.length; i++) {
    const r = ROUTES[i];
    const link = el('a', { class: 'nav-link', href: '#/' + r.name, dataset: { route: r.name }, text: r.title });
    link.addEventListener('keydown', function (ev) {
      if (ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        link.click();
      }
    });
    nav.appendChild(link);
  }
  syncNav();
}

function syncNav() {
  const nav = q('#app-nav');
  if (!nav) return;
  const cur = router.current();
  const links = nav.querySelectorAll('.nav-link');
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const on = link.dataset.route === cur;
    if (on) {
      link.classList.add('is-active');
      link.setAttribute('aria-current', 'page');
    } else {
      link.classList.remove('is-active');
      link.removeAttribute('aria-current');
    }
  }
}

function hasNoProgress() {
  try {
    const st = store.stats(null, hudState.totals || undefined);
    if (st.seen > 0) return false;
    if (store.daily().doneCount > 0) return false;
    if (store.wrong().length > 0) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function renderHud() {
  const hud = q('#app-hud');
  if (!hud) return;
  let daily = { goal: 20, doneCount: 0 };
  try { daily = store.daily(); } catch (e) { /* ignore */ }

  let masteryText = '—';
  try {
    const st = store.stats(null, hudState.totals || undefined);
    if (hudState.totals && st.total > 0) masteryText = Math.round((st.mastered / st.total) * 100) + '%';
  } catch (e) { /* ignore */ }

  hud.innerHTML = '';
  hud.appendChild(
    el('span', { class: 'hud__item' }, [
      el('span', { class: 'hud__label', text: '今日' }),
      el('span', { class: 'hud__value', text: String(daily.doneCount) + '/' + String(daily.goal) }),
    ])
  );
  hud.appendChild(
    el('span', { class: 'hud__item' }, [
      el('span', { class: 'hud__label', text: '掌握度' }),
      el('span', { class: 'hud__value', text: masteryText }),
    ])
  );
  if (hasNoProgress()) {
    hud.appendChild(
      el('span', {
        class: 'hud__hint',
        text: '先从「翻卡」认几个词，再去「小测」自测，答错的词会自动进错词本。',
      })
    );
  }
}

async function initTotals() {
  try {
    const m = await bank.manifest();
    const totals = {};
    const levels = (m && m.levels) || {};
    const keys = Object.keys(levels);
    for (let i = 0; i < keys.length; i++) {
      const n = Number(levels[keys[i]] && levels[keys[i]].count);
      if (isFinite(n)) totals[keys[i]] = n;
    }
    hudState.totals = Object.keys(totals).length ? totals : null;
  } catch (e) {
    hudState.totals = null;
    if (typeof console !== 'undefined' && console.warn) console.warn('[app] 词库清单不可用，掌握度显示为 —', e);
  }
  hudState.totalsLoaded = true;
  renderHud();
}

function boot() {
  if (typeof document === 'undefined') return;
  buildNav();

  for (let i = 0; i < ROUTES.length; i++) {
    (function (r) {
      router.register(r.name, {
        title: r.title,
        mount: function (root) { return mountPending(root, r); },
      });
    })(ROUTES[i]);
  }

  if (typeof window !== 'undefined') window.addEventListener('hashchange', syncNav);
  router.start('plan');
  syncNav();

  try { store.subscribe(renderHud); } catch (e) { /* ignore */ }
  renderHud();
  void initTotals();
}

boot();
