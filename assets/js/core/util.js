/* core/util.js — DOM 与格式工具（owner: S2）
 * 顶层不触碰 document：所有 DOM 访问都发生在函数调用时，便于在 Node 里 import。
 */

function isNode(v) {
  return !!v && typeof v === 'object' && typeof v.nodeType === 'number';
}

function append(node, children) {
  if (children == null || children === false || children === true) return;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) append(node, children[i]);
    return;
  }
  if (isNode(children)) {
    node.appendChild(children);
    return;
  }
  node.appendChild(document.createTextNode(String(children)));
}

/**
 * el('div', {class, text, html, dataset, style, on:{click:fn}, onClick, ...任意属性}, children)
 * children: Node | string | number | array | null（可任意嵌套）
 */
export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  const a = attrs || {};
  const keys = Object.keys(a);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const v = a[key];
    if (v == null || v === false) continue;
    if (key === 'class' || key === 'className') {
      node.className = String(v);
    } else if (key === 'text') {
      node.textContent = String(v);
    } else if (key === 'html') {
      node.innerHTML = String(v);
    } else if (key === 'dataset') {
      if (typeof v === 'object') {
        const dk = Object.keys(v);
        for (let j = 0; j < dk.length; j++) {
          if (v[dk[j]] != null) node.dataset[dk[j]] = String(v[dk[j]]);
        }
      }
    } else if (key === 'style') {
      if (typeof v === 'string') {
        node.setAttribute('style', v);
      } else if (typeof v === 'object') {
        const sk = Object.keys(v);
        for (let j = 0; j < sk.length; j++) {
          try { node.style[sk[j]] = v[sk[j]]; } catch (e) { /* 忽略无法识别的样式 */ }
        }
      }
    } else if (key === 'on') {
      if (typeof v === 'object') {
        const ev = Object.keys(v);
        for (let j = 0; j < ev.length; j++) {
          if (typeof v[ev[j]] === 'function') node.addEventListener(ev[j], v[ev[j]]);
        }
      }
    } else if (key === 'onClick') {
      if (typeof v === 'function') node.addEventListener('click', v);
    } else if (key === 'value') {
      node.value = v;
    } else if (key === 'disabled' || key === 'checked' || key === 'selected' || key === 'readOnly' || key === 'multiple') {
      node[key] = !!v;
      if (key === 'disabled') node.setAttribute('disabled', '');
    } else {
      node.setAttribute(key, v === true ? '' : String(v));
    }
  }
  append(node, children);
  return node;
}

export function q(sel, root) {
  const r = root || (typeof document === 'undefined' ? null : document);
  return r ? r.querySelector(sel) : null;
}

export function qa(sel, root) {
  const r = root || (typeof document === 'undefined' ? null : document);
  if (!r) return [];
  return Array.prototype.slice.call(r.querySelectorAll(sel));
}

export function shuffle(arr) {
  const out = Array.isArray(arr) ? arr.slice() : Array.from(arr || []);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

export function sample(arr, n) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  return shuffle(arr).slice(0, count);
}

export function todayKey(date) {
  const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtPct(x) {
  const n = Number(x);
  if (!isFinite(n)) return '0%';
  return Math.round(n * 100) + '%';
}

export function debounce(fn, ms) {
  const wait = Math.max(0, Number(ms) || 0);
  let timer = null;
  return function debounced() {
    const args = Array.prototype.slice.call(arguments);
    const self = this;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      fn.apply(self, args);
    }, wait);
  };
}

let toastSeq = 0;

export function toast(msg, kind) {
  if (typeof document === 'undefined') return null;
  const k = kind === 'ok' || kind === 'err' ? kind : 'info';
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { class: 'toast-host', id: 'toast-host' });
    if (document.body) document.body.appendChild(host);
  }
  toastSeq += 1;
  const node = el(
    'div',
    {
      class: 'toast' + (k === 'info' ? '' : ' toast--' + k),
      role: 'status',
      'aria-live': 'polite',
      dataset: { toast: String(toastSeq) },
    },
    String(msg == null ? '' : msg)
  );
  host.appendChild(node);
  const remove = function () {
    if (node.parentNode) node.parentNode.removeChild(node);
  };
  const timer = setTimeout(remove, 2400);
  node.addEventListener('click', function () {
    clearTimeout(timer);
    remove();
  });
  return node;
}

export function emptyState(title, desc) {
  const kids = [el('p', { class: 'empty__title', text: title == null ? '' : String(title) })];
  if (desc != null && desc !== '') kids.push(el('p', { class: 'empty__desc', text: String(desc) }));
  return el('div', { class: 'empty' }, kids);
}
