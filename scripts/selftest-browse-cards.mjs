/* scripts/selftest-browse-cards.mjs — S3 词库浏览 / 翻卡记忆 自测（owner: S3）
 * 用法：
 *   node scripts/selftest-browse-cards.mjs          # 纯逻辑 + DOM 桩 mount 级自测
 *   node scripts/selftest-browse-cards.mjs --http    # http 探针（需先起 python -m http.server 8124）
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const fileUrl = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

/* ---------- localStorage 内存 shim（照抄 scripts/selftest-core.mjs） ---------- */
const mem = new Map();
globalThis.localStorage = {
  getItem(k) { const key = String(k); return mem.has(key) ? mem.get(key) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) { const ks = Array.from(mem.keys()); return i >= 0 && i < ks.length ? ks[i] : null; },
  get length() { return mem.size; },
};

/* ---------- 断言 ---------- */
let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name); }
  else { fail += 1; failures.push(name); console.log('FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(name, a === b, 'expected ' + b + ', got ' + a);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 4000);
  while (Date.now() < deadline) {
    let v = null;
    try { v = fn(); } catch (e) { v = null; }
    if (v) return v;
    await wait(25);
  }
  return null;
}

/* =====================================================================
 * 0. http 探针模式：node scripts/selftest-browse-cards.mjs --http
 *    （先起服务：python -m http.server 8124）
 * ===================================================================== */
if (process.argv.includes('--http')) {
  console.log('--- HTTP 探针 ---');
  const base = process.env.HTTP_BASE || 'http://127.0.0.1:8124';
  const targets = [
    '/index.html',
    '/data/manifest.json',
    '/data/cet4.json',
    '/data/cet6.json',
    '/assets/js/features/browse.js',
    '/assets/js/features/cards.js',
    '/assets/css/features/browse.css',
    '/assets/css/features/cards.css',
    '/assets/js/core/bank.js',
  ];
  for (const t of targets) {
    let status = 0;
    let len = 0;
    let err = '';
    try {
      const res = await fetch(base + t);
      status = res.status;
      len = (await res.text()).length;
    } catch (e) {
      err = String((e && e.message) || e);
    }
    check('HTTP 200 ' + t + ' (' + len + ' bytes)', status === 200 && len > 0, err || ('status ' + status));
    if (t === '/data/cet4.json') {
      const data = JSON.parse(await (await fetch(base + t)).text());
      eq('cet4.json words.length === 5871', data.words.length, 5871);
    }
    if (t === '/data/cet6.json') {
      const data = JSON.parse(await (await fetch(base + t)).text());
      eq('cet6.json words.length === 3318', data.words.length, 3318);
    }
  }
  /* 相对路径断言：禁止以斜杠开头的绝对资源路径（GitHub Pages 子路径部署） */
  const browseSrc = await (await fetch(base + '/assets/js/features/browse.js')).text();
  const cardsSrc = await (await fetch(base + '/assets/js/features/cards.js')).text();
  check('browse.js 无绝对资源路径', !/["']\/(data|assets)\//.test(browseSrc));
  check('cards.js 无绝对资源路径', !/["']\/(data|assets)\//.test(cardsSrc));

  console.log('--- HTTP 结果：PASS ' + pass + ' / FAIL ' + fail + ' ---');
  if (fail > 0) {
    console.log('失败项：' + failures.join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

/* =====================================================================
 * A. 模块 import 阶段不得触碰 DOM —— 此刻全局还没有 document
 * ===================================================================== */
console.log('--- A. 模块 import 安全（无 document 环境）---');
check('全局确实没有 document', typeof globalThis.document === 'undefined');

let browseMod = null;
let cardsMod = null;
let importErr = '';
try {
  browseMod = await import(fileUrl('assets/js/features/browse.js'));
} catch (e) {
  importErr = 'browse.js: ' + (e && e.message);
}
check('import browse.js 不抛异常（顶层未访问 document/localStorage）', importErr === '', importErr);

let importErr2 = '';
try {
  cardsMod = await import(fileUrl('assets/js/features/cards.js'));
} catch (e) {
  importErr2 = 'cards.js: ' + (e && e.message);
}
check('import cards.js 不抛异常', importErr2 === '', importErr2);

const { store } = await import(fileUrl('assets/js/core/store.js'));
check('browse.route 结构与契约一致', !!(browseMod && browseMod.route && browseMod.route.name === 'browse' && browseMod.route.title === '词库浏览' && typeof browseMod.route.mount === 'function'));
check('cards.route 结构与契约一致', !!(cardsMod && cardsMod.route && cardsMod.route.name === 'cards' && cardsMod.route.title === '翻卡记忆' && typeof cardsMod.route.mount === 'function'));

const {
  ipaText, formatExample, normalizeQuery, matchQuery, filterWords, chunkOf,
  statsText, levelFromSettings, stateMapOf, stateOfRec,
} = browseMod;
const { buildDeck, deckStats, progressText, progressPercent } = cardsMod;

/* =====================================================================
 * B. 纯逻辑
 * ===================================================================== */
console.log('--- B. browse 纯逻辑 ---');

eq('ipaText 普通音标加方括号', ipaText('ˈkænsl'), '[ˈkænsl]');
eq('ipaText 空字符串不加方括号', ipaText(''), '');
eq('ipaText null 不加方括号', ipaText(null), '');
eq('ipaText undefined 不加方括号', ipaText(undefined), '');
eq('ipaText 纯空白不加方括号', ipaText('   '), '');
eq('ipaText 已带方括号不重复包裹', ipaText('[ˈkænsl]'), '[ˈkænsl]');
eq('ipaText 去首尾空白', ipaText(' ˌʌptəˈdeɪt '), '[ˌʌptəˈdeɪt]');

eq('formatExample(null) → 暂无例句', formatExample(null), { en: '暂无例句', zh: '', empty: true });
eq('formatExample(undefined) → 暂无例句', formatExample(undefined), { en: '暂无例句', zh: '', empty: true });
eq('formatExample({}) → 暂无例句', formatExample({}), { en: '暂无例句', zh: '', empty: true });
eq('formatExample 只有 en', formatExample({ en: 'The meeting was canceled.', src: 'tatoeba' }), { en: 'The meeting was canceled.', zh: '', empty: false });
eq('formatExample 带 zh', formatExample({ en: 'A b.', zh: '甲。' }), { en: 'A b.', zh: '甲。', empty: false });
eq('formatExample 字符串输入按缺失处理', formatExample('oops'), { en: '暂无例句', zh: '', empty: true });

eq('normalizeQuery 去空白转小写', normalizeQuery('  Cancel '), 'cancel');
const wCancel = { key: 'cet4:cancel', word: 'cancel', meanings: ['取消，撤销', '删去'], pos: 'vt.', example: null };
const wAdapt = { key: 'cet4:adapt', word: 'adapt', meanings: ['适应', '改编'], pos: null, example: { en: 'Adapt.', src: 'x' } };
check('matchQuery 空查询全命中', matchQuery(wCancel, '') === true);
check('matchQuery 单词大小写不敏感', matchQuery(wCancel, 'CANCEL') === true);
check('matchQuery 单词子串命中', matchQuery(wCancel, 'anc') === true);
check('matchQuery 中文释义命中', matchQuery(wCancel, '撤销') === true);
check('matchQuery 中文释义第二条命中', matchQuery(wCancel, '删去') === true);
check('matchQuery 不命中', matchQuery(wCancel, 'zzz') === false);
check('matchQuery null 词条不命中', matchQuery(null, 'a') === false);

const items = [wCancel, wAdapt];
const states = { 'cet4:cancel': 'new', 'cet4:adapt': 'mastered' };
const stateOf = (k) => states[k] || 'new';
eq('filterWords 全部', filterWords(items, { query: '', state: 'all' }).map((x) => x.word), ['cancel', 'adapt']);
eq('filterWords 未学', filterWords(items, { query: '', state: 'new', stateOf }).map((x) => x.word), ['cancel']);
eq('filterWords 已掌握', filterWords(items, { query: '', state: 'mastered', stateOf }).map((x) => x.word), ['adapt']);
eq('filterWords 学习中（无命中）', filterWords(items, { query: '', state: 'learning', stateOf }), []);
eq('filterWords 搜索 + 筛选交集', filterWords(items, { query: 'ada', state: 'mastered', stateOf }).map((x) => x.word), ['adapt']);
eq('filterWords 搜索 + 筛选冲突为空', filterWords(items, { query: 'ada', state: 'new', stateOf }), []);
eq('filterWords 缺省 stateOf 时按 new 处理', filterWords(items, { query: '', state: 'new' }).map((x) => x.word), ['cancel', 'adapt']);
eq('filterWords 非法入参不抛错', filterWords(null, null), []);

const seq = Array.from({ length: 130 }, (_, i) => ({ key: 'cet4:w' + i, word: 'w' + i }));
eq('chunkOf 首页 60 条', chunkOf(seq, 0, 60).items.length, 60);
eq('chunkOf 首页 hasMore', chunkOf(seq, 0, 60).hasMore, true);
eq('chunkOf 第二页 60 条', [chunkOf(seq, 60, 60).items.length, chunkOf(seq, 60, 60).start, chunkOf(seq, 60, 60).end], [60, 60, 120]);
eq('chunkOf 末页剩余 10 条且结束', [chunkOf(seq, 120, 60).items.length, chunkOf(seq, 120, 60).hasMore, chunkOf(seq, 120, 60).loaded], [10, false, 130]);
eq('chunkOf 超出末尾不越界', [chunkOf(seq, 500, 60).items.length, chunkOf(seq, 500, 60).hasMore], [0, false]);
eq('chunkOf 空数组', [chunkOf([], 0, 60).items.length, chunkOf([], 0, 60).hasMore, chunkOf([], 0, 60).total], [0, false, 0]);
eq('chunkOf size 大于总数', [chunkOf(seq, 0, 1000).items.length, chunkOf(seq, 0, 1000).hasMore], [130, false]);
eq('chunkOf 非法入参不抛错', chunkOf(null, null, null).total, 0);

eq('statsText 排版', statsText({ total: 5871, seen: 12, mastered: 3 }), '共 5871 词 · 已学 12 · 已掌握 3');
eq('statsText 全 0', statsText({ total: 0, seen: 0, mastered: 0 }), '共 0 词 · 已学 0 · 已掌握 0');
eq('statsText 缺字段', statsText(null), '共 0 词 · 已学 0 · 已掌握 0');
eq('levelFromSettings 默认 cet4', levelFromSettings(null), 'cet4');
eq('levelFromSettings cet6', levelFromSettings({ level: 'cet6' }), 'cet6');
eq('stateOfRec new', stateOfRec({ seen: 0, box: 0 }), 'new');
eq('stateOfRec learning', stateOfRec({ seen: 2, box: 3 }), 'learning');
eq('stateOfRec mastered（box=4）', stateOfRec({ seen: 4, box: 4 }), 'mastered');
eq('stateMapOf 空', stateMapOf(null), {});
eq('stateMapOf 批量', stateMapOf({ a: { seen: 0, box: 0 }, b: { seen: 1, box: 1 }, c: { seen: 5, box: 5 } }), { a: 'new', b: 'learning', c: 'mastered' });

console.log('--- C. cards 纯逻辑 ---');
const deckItems = [
  { key: 'cet4:a', word: 'a' },
  { key: 'cet4:b', word: 'b' },
  { key: 'cet4:c', word: 'c' },
  { key: 'cet4:d', word: 'd' },
  { key: 'cet4:e', word: 'e' },
];
const deckStates = { 'cet4:a': 'new', 'cet4:b': 'learning', 'cet4:c': 'mastered', 'cet4:d': 'new', 'cet4:e': 'learning' };
const keysOf = (deck) => deck.map((x) => x.key).sort();
eq('buildDeck new 只含未学', keysOf(buildDeck(deckItems, { scope: 'new', states: deckStates, limit: 0 })), ['cet4:a', 'cet4:d']);
eq('buildDeck learning 只含学习中', keysOf(buildDeck(deckItems, { scope: 'learning', states: deckStates, limit: 0 })), ['cet4:b', 'cet4:e']);
eq('buildDeck random 排除已掌握', keysOf(buildDeck(deckItems, { scope: 'random', states: deckStates, limit: 0 })), ['cet4:a', 'cet4:b', 'cet4:d', 'cet4:e']);
eq('buildDeck today 排除已掌握', keysOf(buildDeck(deckItems, { scope: 'today', states: deckStates, limit: 0 })), ['cet4:a', 'cet4:b', 'cet4:d', 'cet4:e']);
eq('buildDeck 默认 scope=today', keysOf(buildDeck(deckItems, { states: deckStates, limit: 0 })), ['cet4:a', 'cet4:b', 'cet4:d', 'cet4:e']);

const todayDeck = buildDeck(deckItems, { scope: 'today', states: deckStates, todayKeys: ['cet4:a', 'cet4:b'], limit: 0 });
check('buildDeck today 今日未学的排在前面', todayDeck.slice(0, 2).every((x) => x.key === 'cet4:d' || x.key === 'cet4:e'), todayDeck.map((x) => x.key).join(','));
eq('buildDeck today 今日已学的排在后面', todayDeck.slice(2).map((x) => x.key).sort(), ['cet4:a', 'cet4:b']);
eq('buildDeck today 接受 Set 形式的 todayKeys', keysOf(buildDeck(deckItems, { scope: 'today', states: deckStates, todayKeys: new Set(['cet4:a']), limit: 0 })), ['cet4:a', 'cet4:b', 'cet4:d', 'cet4:e']);
eq('buildDeck limit 生效', buildDeck(deckItems, { scope: 'random', states: deckStates, limit: 2 }).length, 2);
eq('buildDeck limit=0 不限', buildDeck(deckItems, { scope: 'random', states: deckStates, limit: 0 }).length, 4);
eq('buildDeck 默认上限 60', buildDeck(Array.from({ length: 200 }, (_, i) => ({ key: 'cet4:k' + i, word: 'k' + i })), {}).length, 60);
eq('buildDeck 空输入', buildDeck(null, {}), []);
eq('buildDeck 不重复', new Set(buildDeck(deckItems, { scope: 'random', states: deckStates, limit: 0 }).map((x) => x.key)).size, 4);

eq('deckStats 全对', deckStats({ a: true, b: true }), { known: 2, unknown: 0, total: 2, accuracy: 1 });
eq('deckStats 混合', deckStats({ a: true, b: false, c: true, d: false }), { known: 2, unknown: 2, total: 4, accuracy: 0.5 });
eq('deckStats 空', deckStats({}), { known: 0, unknown: 0, total: 0, accuracy: 0 });
eq('deckStats 数组入参', deckStats([{ correct: true }, { correct: false }]).known, 1);

eq('progressText 第 1 张', progressText(0, 10, 0), '第 1 / 10 张 · 本次已评价 0 个');
eq('progressText 第 10 张', progressText(9, 10, 9), '第 10 / 10 张 · 本次已评价 9 个');
eq('progressText 越界夹取', progressText(99, 10, 3), '第 10 / 10 张 · 本次已评价 3 个');
eq('progressText 空牌堆', progressText(0, 0, 0), '牌堆为空');
eq('progressPercent 首张', progressPercent(0, 10), 10);
eq('progressPercent 末张', progressPercent(9, 10), 100);
eq('progressPercent 空牌堆', progressPercent(0, 0), 0);

/* =====================================================================
 * D. 极简 DOM 桩 + 真实词库数据（fetch 打到本地 data/）→ mount 级自测
 * ===================================================================== */
console.log('--- D. DOM 桩 mount 自测（真实 data/ 词库）---');

function makeNode(tagName, nodeType) {
  const node = {
    nodeType: nodeType || 1,
    tagName: String(tagName || 'div').toUpperCase(),
    children: [],
    attrs: {},
    dataset: {},
    style: {},
    listeners: {},
    className: '',
    textContent: '',
    value: '',
    hidden: false,
    parentNode: null,
    appendChild(child) {
      if (!child) return child;
      if (child.nodeType === 11) {
        const kids = child.children.slice();
        child.children.length = 0;
        for (const k of kids) { k.parentNode = this; this.children.push(k); }
        return child;
      }
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child) { return this.appendChild(child); },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      return child;
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const list = this.listeners[type];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    querySelector(sel) { return findAllByClass(this, String(sel).replace(/^\./, ''))[0] || null; },
    querySelectorAll(sel) { return findAllByClass(this, String(sel).replace(/^\./, '')); },
  };
  let html = '';
  Object.defineProperty(node, 'innerHTML', {
    get() { return html; },
    set(v) { html = String(v); if (html === '') this.children.length = 0; },
  });
  Object.defineProperty(node, 'firstChild', { get() { return this.children[0] || null; } });
  return node;
}
function hasClass(node, cls) {
  return String(node.className || '').split(/\s+/).indexOf(cls) >= 0;
}
function findAllByClass(root, cls, out) {
  const acc = out || [];
  const kids = root.children || [];
  for (const k of kids) {
    if (k.nodeType === 1) {
      if (hasClass(k, cls)) acc.push(k);
      findAllByClass(k, cls, acc);
    }
  }
  return acc;
}
function fire(node, type, ev) {
  const list = (node.listeners[type] || []).slice();
  const event = ev || { type, key: '', target: node, preventDefault() {}, stopPropagation() {} };
  for (const fn of list) fn(event);
}
function typeIn(node, value, type) {
  node.value = value;
  fire(node, type || 'input');
}

const docListeners = {};
globalThis.document = {
  baseURI: 'http://127.0.0.1:8124/',
  createElement(tag) { return makeNode(tag, 1); },
  createTextNode(text) { const n = makeNode('#text', 3); n.textContent = String(text); return n; },
  createDocumentFragment() { return makeNode('#fragment', 11); },
  getElementById() { return null; },
  addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
  removeEventListener(type, fn) {
    const list = docListeners[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  },
};

/* fetch 打到本地 data/（模拟浏览器同源请求，bank.js 无需改动） */
const rawCache = new Map();
globalThis.fetch = async function (url) {
  const name = String(url).split('/').pop().split('?')[0];
  if (!rawCache.has(name)) rawCache.set(name, JSON.parse(await readFile(path.join(ROOT, 'data', name), 'utf8')));
  const data = rawCache.get(name);
  return { ok: true, status: 200, json: async () => data };
};

/* ---- D1. browse.mount ---- */
store.reset();
let mountErr = '';
let browseCleanup = null;
const browseRoot = makeNode('main', 1);
try {
  browseCleanup = browseMod.route.mount(browseRoot);
} catch (e) {
  mountErr = String((e && e.stack) || e);
}
check('browse.mount 同步装配不抛错', mountErr === '', mountErr);
check('browse.mount 返回可调用的 cleanup', typeof browseCleanup === 'function');

const browseList = await waitFor(() => {
  const el = findAllByClass(browseRoot, 'browse__list')[0];
  return el && el.children.length ? el : null;
}, 6000);
check('browse 首屏渲染出词条卡', !!browseList);
console.log('      首屏实际条数 = ' + (browseList ? browseList.children.length : 0));
eq('browse 首屏条数 = PAGE_SIZE(60)', browseList ? browseList.children.length : 0, 60);

const statsLine = findAllByClass(browseRoot, 'browse__stats')[0];
check('browse 统计条来自 store.stats + bank.count', !!statsLine && statsLine.textContent.indexOf('共 5871 词') === 0, statsLine && statsLine.textContent);

const firstCard = browseList.children[0];
check('browse 词条卡含 word/音标/释义', findAllByClass(firstCard, 'word-card__word').length === 1 && findAllByClass(firstCard, 'word-card__meanings')[0].children.length > 0);
const firstWord = findAllByClass(firstCard, 'word-card__word')[0].textContent;
check('browse 词条卡首个单词非空', typeof firstWord === 'string' && firstWord.length > 0, firstWord);

/* 例句展开/收起 */
const toggleBtn = findAllByClass(firstCard, 'word-card__toggle')[0];
const exampleBox = findAllByClass(firstCard, 'word-card__example')[0];
check('browse 例句区默认折叠', exampleBox.hidden === true);
fire(toggleBtn, 'click');
check('browse 点「例句」展开', exampleBox.hidden === false && toggleBtn.getAttribute('aria-expanded') === 'true');
check('browse 展开后按钮文案变「收起例句」', toggleBtn.textContent === '收起例句');
fire(toggleBtn, 'click');
check('browse 再点收起', exampleBox.hidden === true && toggleBtn.getAttribute('aria-expanded') === 'false');

/* 加载更多 */
const moreWrap = findAllByClass(browseRoot, 'browse__more')[0];
const moreBtn = findAllByClass(browseRoot, 'browse__more-btn')[0];
check('browse 有「加载更多」可见', moreWrap.hidden === false);
fire(moreBtn, 'click');
eq('browse 加载更多后 120 条', browseList.children.length, 120);

/* 搜索（含防抖 200ms） */
const searchInput = findAllByClass(browseRoot, 'browse__search')[0];
typeIn(searchInput, 'CANCEL');
await wait(360);
eq('browse 搜索大小写不敏感且重排结果', browseList.children.length, 1);
const searched = findAllByClass(browseList.children[0], 'word-card__word')[0].textContent;
check('browse 搜索结果含 cancel', String(searched).toLowerCase().indexOf('cancel') >= 0, searched);

typeIn(searchInput, 'a');
await wait(360);
eq('browse 宽泛搜索首屏仍只渲染 60 条', browseList.children.length, 60);
fire(moreBtn, 'click');
eq('browse 宽泛搜索加载更多到 120 条', browseList.children.length, 120);

/* 空状态 */
typeIn(searchInput, 'zzzzzz');
await wait(360);
const emptyBox = findAllByClass(browseRoot, 'browse__empty')[0];
check('browse 无结果时显示 emptyState', emptyBox.hidden === false && !!findAllByClass(emptyBox, 'empty__title')[0], emptyBox && emptyBox.hidden);

/* 清空搜索恢复 */
typeIn(searchInput, '');
await wait(360);
check('browse 清空搜索恢复列表', browseList.children.length === 60 && findAllByClass(browseRoot, 'browse__empty')[0].hidden === true);

/* 级别切换写回 settings */
const levelBtns = findAllByClass(browseRoot, 'browse__level');
check('browse 级别按钮 2 个', levelBtns.length === 2);
eq('browse 默认级别按钮为四级', levelBtns[0].getAttribute('aria-pressed'), 'true');
fire(levelBtns[1], 'click');
eq('browse 切到六级写回 settings', store.settings().level, 'cet6');
const cet6List = await waitFor(() => {
  const el = findAllByClass(browseRoot, 'browse__list')[0];
  return el.children.length === 60 ? el : null;
}, 6000);
check('browse 六级渲染成功', !!cet6List);
check('browse 六级统计条切换', findAllByClass(browseRoot, 'browse__stats')[0].textContent.indexOf('共 3318 词') === 0, findAllByClass(browseRoot, 'browse__stats')[0].textContent);
fire(levelBtns[0], 'click');
await waitFor(() => findAllByClass(browseRoot, 'browse__stats')[0].textContent.indexOf('共 5871 词') === 0, 6000);

let cleanupErr = '';
try { browseCleanup(); } catch (e) { cleanupErr = String(e); }
check('browse cleanup 调用不抛错', cleanupErr === '', cleanupErr);

/* ---- D2. cards.mount ---- */
store.reset();
store.updateSettings({ level: 'cet4' });
let cardsErr = '';
let cardsCleanup = null;
const cardsRoot = makeNode('main', 1);
try {
  cardsCleanup = cardsMod.route.mount(cardsRoot);
} catch (e) {
  cardsErr = String((e && e.stack) || e);
}
check('cards.mount 同步装配不抛错', cardsErr === '', cardsErr);
check('cards.mount 返回可调用的 cleanup', typeof cardsCleanup === 'function');
check('cards.mount 注册了全局 keydown', (docListeners.keydown || []).length === 1, String((docListeners.keydown || []).length));

const metaEl = findAllByClass(cardsRoot, 'cards__meta')[0];
await waitFor(() => metaEl.textContent.indexOf('牌堆为空') < 0 && metaEl.textContent.indexOf('正在准备') < 0, 6000);
console.log('      进度文案 = ' + metaEl.textContent);
eq('cards 首张进度文案', metaEl.textContent, '第 1 / 60 张 · 本次已评价 0 个');

const frontFace = findAllByClass(cardsRoot, 'flip-card__face--front')[0];
const backFace = findAllByClass(cardsRoot, 'flip-card__face--back')[0];
check('cards 正面有单词', findAllByClass(frontFace, 'cards__word').length === 1);
check('cards 背面有释义', findAllByClass(backFace, 'cards__meanings')[0].children.length > 0);
check('cards 背面例句不缺位（有则英文，无则「暂无例句」）', findAllByClass(backFace, 'cards__ex-en').length + findAllByClass(backFace, 'cards__noex').length === 1);

const flipBtn = findAllByClass(cardsRoot, 'flip-card')[0];
check('cards 默认未翻面', hasClass(flipBtn, 'is-flipped') === false);
fire(flipBtn, 'click');
check('cards 点击翻面', hasClass(flipBtn, 'is-flipped') === true && flipBtn.getAttribute('aria-pressed') === 'true');
fire(flipBtn, 'click');
check('cards 再点翻回正面', hasClass(flipBtn, 'is-flipped') === false);

/* 空格翻面（焦点不在按钮上时由全局快捷键处理） */
const spaceEv = { type: 'keydown', key: ' ', target: makeNode('div'), preventDefault() {}, stopPropagation() {} };
for (const fn of (docListeners.keydown || []).slice()) fn(spaceEv);
check('cards 空格翻面', hasClass(flipBtn, 'is-flipped') === true);
for (const fn of (docListeners.keydown || []).slice()) fn(spaceEv);
check('cards 空格再翻回', hasClass(flipBtn, 'is-flipped') === false);

/* 评级：认识 → markSeen(true) + 自动切下一张 */
const knownBtn = findAllByClass(cardsRoot, 'cards__known')[0];
fire(knownBtn, 'click');
await wait(360);
eq('cards 评价后切到第 2 张', metaEl.textContent, '第 2 / 60 张 · 本次已评价 1 个');
const seenCount = store.stats('cet4', 5871).seen;
eq('cards 「认识」写入 store（seen=1）', seenCount, 1);
const markedKey = Object.keys(store.exportAll().recs)[0];
eq('cards 「认识」记 right=1', store.rec(markedKey).right, 1);
eq('cards 「认识」box 升到 1', store.rec(markedKey).box, 1);

/* 评级：不认识 */
const unknownBtn = findAllByClass(cardsRoot, 'cards__unknown')[0];
fire(unknownBtn, 'click');
await wait(360);
eq('cards 「不认识」后到第 3 张', metaEl.textContent, '第 3 / 60 张 · 本次已评价 2 个');
eq('cards 「不认识」计入 wrong', Object.values(store.exportAll().recs).filter((r) => r.wrong === 1).length, 1);

/* 键盘 J / K */
for (const fn of (docListeners.keydown || []).slice()) fn({ type: 'keydown', key: 'j', target: makeNode('div'), preventDefault() {}, stopPropagation() {} });
await wait(360);
eq('cards 键盘 J = 认识', metaEl.textContent, '第 4 / 60 张 · 本次已评价 3 个');
for (const fn of (docListeners.keydown || []).slice()) fn({ type: 'keydown', key: '2', target: makeNode('div'), preventDefault() {}, stopPropagation() {} });
await wait(360);
eq('cards 键盘 2 = 不认识', metaEl.textContent, '第 5 / 60 张 · 本次已评价 4 个');

/* 上一张不写进度 */
const beforeSeen = store.stats('cet4', 5871).seen;
for (const fn of (docListeners.keydown || []).slice()) fn({ type: 'keydown', key: 'ArrowLeft', target: makeNode('div'), preventDefault() {}, stopPropagation() {} });
eq('cards ← 回到第 4 张', metaEl.textContent, '第 4 / 60 张 · 本次已评价 4 个');
eq('cards ← 不写进度', store.stats('cet4', 5871).seen, beforeSeen);
for (const fn of (docListeners.keydown || []).slice()) fn({ type: 'keydown', key: 'ArrowRight', target: makeNode('div'), preventDefault() {}, stopPropagation() {} });
eq('cards → 前进', metaEl.textContent, '第 5 / 60 张 · 本次已评价 4 个');

/* 牌堆走完 → 总结 */
for (let i = 0; i < 70; i++) {
  for (const fn of (docListeners.keydown || []).slice()) fn({ type: 'keydown', key: 'ArrowRight', target: makeNode('div'), preventDefault() {}, stopPropagation() {} });
}
const doneEl = findAllByClass(cardsRoot, 'cards__done')[0];
const stageEl = findAllByClass(cardsRoot, 'cards__stage')[0];
check('cards 走完牌堆显示总结', doneEl.hidden === false && stageEl.hidden === true);
check('cards 总结含认识/不认识/正确率', findAllByClass(doneEl, 'stat__label').map((n) => n.textContent).join(',') === '认识,不认识,正确率', findAllByClass(doneEl, 'stat__label').map((n) => n.textContent).join(','));
const againBtn = findAllByClass(cardsRoot, 'cards__again')[0];
fire(againBtn, 'click');
const restarted = await waitFor(() => metaEl.textContent.indexOf('第 1 /') === 0, 6000);
check('cards 「再来一组」重开牌堆', !!restarted, metaEl.textContent);
check('cards 重开后总结隐藏', findAllByClass(cardsRoot, 'cards__done')[0].hidden === true);

/* 范围筛选：全部掌握后今日范围应无词 */
store.reset();
store.updateSettings({ level: 'cet4' });
const tinyState = { 'cet4:x': 'mastered' };
eq('buildDeck 全掌握时今日范围为空', buildDeck([{ key: 'cet4:x', word: 'x' }], { scope: 'today', states: tinyState, limit: 0 }), []);

let cardsCleanupErr = '';
try { cardsCleanup(); } catch (e) { cardsCleanupErr = String(e); }
check('cards cleanup 调用不抛错', cardsCleanupErr === '', cardsCleanupErr);
check('cards cleanup 解绑全局 keydown', (docListeners.keydown || []).length === 0, String((docListeners.keydown || []).length));

/* 最小化动画偏好：仅断言 CSS 文件里存在对应媒体查询 */
const cardsCssText = await readFile(path.join(ROOT, 'assets/css/features/cards.css'), 'utf8');
check('cards.css 含 prefers-reduced-motion 降级', cardsCssText.indexOf('prefers-reduced-motion: reduce') >= 0);
check('cards.css 用 rotateY 做 3D 翻转', cardsCssText.indexOf('rotateY(180deg)') >= 0);

/* =====================================================================
 * E. 汇总
 * ===================================================================== */
console.log('--- 结果：PASS ' + pass + ' / FAIL ' + fail + ' ---');
if (fail > 0) {
  console.log('失败项：' + failures.join(' | '));
  process.exit(1);
}
process.exit(0);
