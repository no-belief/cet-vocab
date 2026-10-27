/* core/router.js — hash 路由（owner: S2） */
import { emptyState } from './util.js';

const SITE_TITLE = '四六级词汇复习';

const routes = new Map();
const state = { current: null, cleanup: null, started: false, defaultName: 'plan' };

function viewEl() {
  return typeof document === 'undefined' ? null : document.getElementById('view');
}

function nameFromHash() {
  const raw = typeof location === 'undefined' ? '' : String(location.hash || '');
  if (!raw) return '';
  let s = raw.charAt(0) === '#' ? raw.slice(1) : raw;
  if (s.charAt(0) === '/') s = s.slice(1);
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  if (s.charAt(s.length - 1) === '/') s = s.slice(0, -1);
  return s.trim().toLowerCase();
}

function safeCleanup() {
  const fn = state.cleanup;
  state.cleanup = null;
  if (typeof fn === 'function') {
    try { fn(); } catch (e) { if (typeof console !== 'undefined' && console.warn) console.warn('[router] cleanup 出错', e); }
  }
}

function render(name) {
  const def = routes.get(name);
  const root = viewEl();
  if (!def || !root) return false;
  safeCleanup();
  root.innerHTML = '';
  root.setAttribute('data-route', name);
  if (typeof document !== 'undefined') document.title = def.title ? def.title + ' · ' + SITE_TITLE : SITE_TITLE;
  state.current = name;
  let cleanup = null;
  try {
    cleanup = def.mount(root);
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[router] 渲染 "' + name + '" 失败', e);
    root.innerHTML = '';
    root.appendChild(emptyState('页面渲染失败', '「' + (def.title || name) + '」暂时无法显示，可以切换到其他页面。'));
  }
  state.cleanup = typeof cleanup === 'function' ? cleanup : null;
  return true;
}

function go(name) {
  const n = String(name == null ? '' : name).trim().toLowerCase();
  if (!n) return false;
  const target = n.charAt(0) === '#' ? n : '#/' + n;
  if (typeof location !== 'undefined') {
    if (location.hash === target) return true;
    location.hash = target;
  }
  return true;
}

function onHashChange() {
  const n = nameFromHash();
  if (!n || !routes.has(n)) {
    const fallback = routes.has(state.defaultName) ? state.defaultName : routes.keys().next().value;
    if (!fallback) return;
    if (typeof history !== 'undefined' && history.replaceState) {
      try { history.replaceState(null, '', '#/' + fallback); } catch (e) { /* ignore */ }
    }
    if (n !== fallback) render(fallback);
    return;
  }
  if (n !== state.current) render(n);
}

function register(name, def) {
  const n = String(name == null ? '' : name).trim().toLowerCase();
  if (!n) throw new Error('router.register 需要路由名');
  routes.set(n, { name: n, title: (def && def.title) || n, mount: (def && def.mount) || function () {} });
  return router;
}

function start(defaultName) {
  const def = String(defaultName == null ? 'plan' : defaultName).trim().toLowerCase() || 'plan';
  state.defaultName = def;
  if (state.started) return;
  state.started = true;
  let name = nameFromHash();
  if (!name || !routes.has(name)) {
    name = routes.has(def) ? def : routes.keys().next().value;
    if (!name) return;
    if (typeof history !== 'undefined' && history.replaceState) {
      try { history.replaceState(null, '', '#/' + name); } catch (e) { /* ignore */ }
    }
  }
  render(name);
  if (typeof window !== 'undefined') window.addEventListener('hashchange', onHashChange);
}

function current() {
  return state.current;
}

export const router = {
  register: register,
  start: start,
  go: go,
  current: current,
};

export default router;
