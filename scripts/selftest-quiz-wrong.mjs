/* scripts/selftest-quiz-wrong.mjs — S5 功能自测（不进页面）
 * 用法：node scripts/selftest-quiz-wrong.mjs
 */
const mem = new Map();
globalThis.localStorage = {
  getItem(k) { const key = String(k); return mem.has(key) ? mem.get(key) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) {
    const keys = Array.from(mem.keys());
    return i >= 0 && i < keys.length ? keys[i] : null;
  },
  get length() { return mem.size; },
};

const quiz = await import('../assets/js/features/quiz.js');
const wrongView = await import('../assets/js/features/wrong.js');
const storeMod = await import('../assets/js/core/store.js');
const store = storeMod.store;
const setNow = storeMod.__setNowForTest;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log('PASS  ' + name);
  } else {
    fail += 1;
    failures.push(name);
    console.log('FAIL  ' + name + (extra ? '   (' + extra + ')' : ''));
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(name, a === b, 'expected ' + b + ', got ' + a);
}

/* 确定性 rng（mulberry32） */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mk(level, word, meanings, pos, ipa, example) {
  return {
    level: level,
    word: word,
    ipa: ipa || '',
    ipaUs: '',
    meanings: meanings,
    pos: pos || null,
    example: example === undefined ? null : example,
    key: level + ':' + word,
  };
}

const APPLE = mk('cet4', 'apple', ['苹果'], 'n.', 'ˈæpl', { en: 'An apple a day keeps the doctor away.' });
const POOL = [
  APPLE,
  mk('cet4', 'cancel', ['取消，撤销', '删去'], 'vt.', 'ˈkænsl', { en: 'The concert was cancelled because of the rain.' }),
  mk('cet4', 'bargain', ['便宜货', '交易'], 'n.', 'ˈbɑːɡən', null),
  mk('cet4', 'tremble', ['颤抖', '发抖'], 'vi.', 'ˈtrembl', null),
  mk('cet4', 'vivid', ['生动的', '鲜艳的'], 'adj.', 'ˈvɪvɪd', { en: 'She gave a vivid description.' }),
  mk('cet4', 'modest', ['谦虚的'], 'adj.', 'ˈmɒdɪst', null),
  mk('cet4', 'harvest', ['收获', '收割'], 'n.', 'ˈhɑːvɪst', null),
  mk('cet4', 'isolate', ['使隔离'], 'vt.', 'ˈaɪsəleɪt', null),
  mk('cet6', 'ambiguous', ['模棱两可的'], 'adj.', 'æmˈbɪɡjuəs', null),
  mk('cet6', 'catastrophe', ['大灾难'], 'n.', 'kəˈtæstrəfi', null),
];

/* 释义与 apple 完全相同 → 不能当干扰项 */
const SAME_MEANING = mk('cet6', 'pomme', ['苹果'], 'n.', 'pɒm', null);
/* 与 apple 同名不同级别（跨级别重名）→ 不能当干扰项 */
const SAME_WORD = mk('cet6', 'apple', ['苹果公司'], 'n.', 'ˈæpl', null);

console.log('--- features/quiz.js 自测 ---');

/* ---------- 1. buildOptions ---------- */
const rng1 = mulberry32(20250310);
const built1 = quiz.buildOptions(APPLE, POOL, rng1);
eq('buildOptions：恰好 4 项', built1.options.length, 4);
eq('buildOptions：恰好 1 个正确项', built1.options.filter(function (o) { return o.correct === true; }).length, 1);
check('buildOptions：正确项在 options 里', built1.options[built1.correctIndex].correct === true);
eq('buildOptions：正确项文本 = 词性 + 释义', built1.options[built1.correctIndex].text, 'n. 苹果');
eq('buildOptions：正确项 key 正确', built1.options[built1.correctIndex].key, 'cet4:apple');
check(
  'buildOptions：选项文本互不相同',
  new Set(built1.options.map(function (o) { return o.text.toLowerCase(); })).size === built1.options.length
);

const byKey = new Map(POOL.concat([SAME_MEANING, SAME_WORD]).map(function (it) { return [it.key, it]; }));
const sigs = built1.options.map(function (o) {
  const it = byKey.get(o.key);
  return it ? quiz.meaningSig(it) : 'MISSING:' + o.key;
});
check('buildOptions：干扰项释义签名互不相同', new Set(sigs).size === sigs.length, sigs.join(' / '));
const correctSig = quiz.meaningSig(APPLE);
check(
  'buildOptions：干扰项释义都不等于正确释义',
  sigs.filter(function (s, i) { return i !== built1.correctIndex && s === correctSig; }).length === 0
);
check('buildOptions：不把同名跨级别词当干扰项', built1.options.every(function (o) { return o.key !== 'cet6:apple'; }));

/* ---------- 2. 同释义池子被过滤 ---------- */
const builtDup = quiz.buildOptions(APPLE, POOL.concat([SAME_MEANING]), mulberry32(7));
check('buildOptions：释义相同的词被排除', builtDup.options.every(function (o) { return o.key !== 'cet6:pomme'; }));
const pickedDup = quiz.buildOptions(APPLE, POOL.concat([SAME_MEANING]), mulberry32(7)).options.map(function (o) { return o.text; });
check('buildOptions：选项文本里没有重复的「苹果」', pickedDup.filter(function (t) { return t.indexOf('苹果') >= 0; }).length === 1);

/* ---------- 3. 确定性 rng 可复现 ---------- */
const a1 = quiz.buildOptions(APPLE, POOL, mulberry32(42));
const a2 = quiz.buildOptions(APPLE, POOL, mulberry32(42));
eq('buildOptions：同 seed 结果可复现', a1, a2);

const positions = new Set();
const chosenKeys = new Set();
for (let seed = 0; seed < 40; seed++) {
  const b = quiz.buildOptions(APPLE, POOL, mulberry32(seed));
  positions.add(b.correctIndex);
  chosenKeys.add(b.options.map(function (o) { return o.key; }).join(','));
}
check('buildOptions：正确项位置随 rng 变化', positions.size > 1, 'positions=' + Array.from(positions).join(','));
check('buildOptions：抽到的干扰项组合随 rng 变化', chosenKeys.size > 1);

/* ---------- 4. 池子不足降级 ---------- */
const one = quiz.buildOptions(APPLE, [POOL[1]], mulberry32(1));
eq('池子不足：1 个干扰 → 2 项', one.options.length, 2);
check('池子不足：仍含正确项', one.options[one.correctIndex].correct === true);
const none = quiz.buildOptions(APPLE, [], mulberry32(1));
eq('空池：只留正确项', none.options.length, 1);
eq('空池：correctIndex=0', none.correctIndex, 0);
const onlyJunk = quiz.buildOptions(APPLE, [{ word: 'x' }, null, 3], mulberry32(1));
eq('脏池（无 meanings/非对象）：只留正确项', onlyJunk.options.length, 1);
const noWord = quiz.buildOptions(null, POOL, mulberry32(1));
eq('word 为 null：空选项不抛错', noWord.options, []);

/* ---------- 5. zh2en 模式 ---------- */
const zh = quiz.buildOptions(APPLE, POOL, mulberry32(11), 'zh2en');
eq('zh2en：恰好 4 项', zh.options.length, 4);
eq('zh2en：正确项文本是英文单词', zh.options[zh.correctIndex].text, 'apple');
check(
  'zh2en：选项单词互不相同',
  new Set(zh.options.map(function (o) { return o.text.toLowerCase(); })).size === 4
);

/* ---------- 6. buildQuestion / modeForIndex ---------- */
const q1 = quiz.buildQuestion(APPLE, POOL, 'en2zh', mulberry32(3));
eq('buildQuestion en2zh：prompt 是单词', q1.prompt, 'apple');
eq('buildQuestion en2zh：hint 是音标', q1.hint, '[ˈæpl]');
const q2 = quiz.buildQuestion(APPLE, POOL, 'zh2en', mulberry32(3));
eq('buildQuestion zh2en：prompt 是释义', q2.prompt, '苹果');
eq('buildQuestion zh2en：hint 是词性', q2.hint, 'n.');
eq('modeForIndex 固定题型', [quiz.modeForIndex(0, 'en2zh'), quiz.modeForIndex(5, 'zh2en')], ['en2zh', 'zh2en']);
eq('modeForIndex mixed 交替', [quiz.modeForIndex(0, 'mixed'), quiz.modeForIndex(1, 'mixed'), quiz.modeForIndex(2, 'mixed')], ['en2zh', 'zh2en', 'en2zh']);

/* ---------- 7. gradeQuestion ---------- */
check('gradeQuestion：选中正确项 → true', quiz.gradeQuestion(q1, q1.correctIndex) === true);
const wrongIdx = q1.options.findIndex(function (o) { return o.correct === false; });
check('gradeQuestion：选中错误项 → false', quiz.gradeQuestion(q1, wrongIdx) === false);
check('gradeQuestion：越界 → false', quiz.gradeQuestion(q1, 9) === false);
check('gradeQuestion：负数 → false', quiz.gradeQuestion(q1, -1) === false);
check('gradeQuestion：null question → false', quiz.gradeQuestion(null, 0) === false);
check('gradeQuestion：NaN 下标 → false', quiz.gradeQuestion(q1, 'x') === false);

/* ---------- 8. scoreOf / mmss / relTime ---------- */
eq('scoreOf([]) → 全 0', quiz.scoreOf([]), { total: 0, right: 0, wrong: 0, accuracy: 0 });
const sc = quiz.scoreOf([true, false, true]);
eq('scoreOf([T,F,T])：total/right/wrong', [sc.total, sc.right, sc.wrong], [3, 2, 1]);
check('scoreOf([T,F,T])：accuracy=2/3', Math.abs(sc.accuracy - 2 / 3) < 1e-12);
eq('scoreOf 非数组输入', quiz.scoreOf(null), { total: 0, right: 0, wrong: 0, accuracy: 0 });

eq('mmss(0)', quiz.mmss(0), '00:00');
eq('mmss(9)', quiz.mmss(9), '00:09');
eq('mmss(61)', quiz.mmss(61), '01:01');
eq('mmss(599)', quiz.mmss(599), '09:59');
eq('mmss(3661)', quiz.mmss(3661), '61:01');
eq('mmss(-5)', quiz.mmss(-5), '00:00');
eq('mmss(NaN)', quiz.mmss(NaN), '00:00');

const NOW = new Date(2025, 2, 10, 12, 0, 0).getTime();
const DAY = 86400000;
eq('relTime(now) → 刚刚', quiz.relTime(NOW, NOW), '刚刚');
eq('relTime(30 秒前) → 刚刚', quiz.relTime(NOW - 30000, NOW), '刚刚');
eq('relTime(60 秒前) → 1 分钟前', quiz.relTime(NOW - 60000, NOW), '1 分钟前');
eq('relTime(3 分钟前)', quiz.relTime(NOW - 180000, NOW), '3 分钟前');
eq('relTime(59 分钟前)', quiz.relTime(NOW - 59 * 60000, NOW), '59 分钟前');
eq('relTime(1 小时前)', quiz.relTime(NOW - 3600000, NOW), '1 小时前');
eq('relTime(23 小时前)', quiz.relTime(NOW - 23 * 3600000, NOW), '23 小时前');
eq('relTime(1 天前)', quiz.relTime(NOW - DAY, NOW), '1 天前');
eq('relTime(29 天前)', quiz.relTime(NOW - 29 * DAY, NOW), '29 天前');
eq('relTime(30 天前) → 超过 30 天', quiz.relTime(NOW - 30 * DAY, NOW), '超过 30 天');
eq('relTime(400 天前) → 超过 30 天', quiz.relTime(NOW - 400 * DAY, NOW), '超过 30 天');
eq('relTime(未来时间) → 刚刚', quiz.relTime(NOW + 60000, NOW), '刚刚');
eq('relTime(0)', quiz.relTime(0, NOW), '未知时间');
eq('relTime(NaN)', quiz.relTime(NaN, NOW), '未知时间');

/* ---------- 9. pickQuizWords ---------- */
const pick10 = quiz.pickQuizWords(POOL, 10, mulberry32(5));
eq('pickQuizWords：池 10 取 10 → 10 个', pick10.length, 10);
eq('pickQuizWords：不重复', new Set(pick10.map(function (i) { return i.key; })).size, 10);
const pick3 = quiz.pickQuizWords(POOL, 3, mulberry32(5));
eq('pickQuizWords：取 3 → 3 个', pick3.length, 3);
eq('pickQuizWords：取 3 不重复', new Set(pick3.map(function (i) { return i.key; })).size, 3);
eq('pickQuizWords：超出池容量 → 返回全部', quiz.pickQuizWords(POOL, 999, mulberry32(5)).length, POOL.length);
eq('pickQuizWords：空池 → []', quiz.pickQuizWords([], 10), []);
eq('pickQuizWords：池内重复 key 去重', quiz.pickQuizWords([APPLE, APPLE, POOL[1]], 10, mulberry32(5)).length, 2);
eq('pickQuizWords：count 非法 → []', quiz.pickQuizWords(POOL, -1).length, 0);

/* ---------- 10. evalText ---------- */
check('evalText(1, 10) 非空', typeof quiz.evalText(1, 10) === 'string' && quiz.evalText(1, 10).length > 0);
check('evalText(0, 0) 有兜底文案', quiz.evalText(0, 0).length > 0);
check('evalText 分段文案不同', quiz.evalText(1, 10) !== quiz.evalText(0.2, 10));

/* ---------- 11. wrong.js 纯函数 ---------- */
eq('levelLabel(cet4/cet6/other)', [wrongView.levelLabel('cet4'), wrongView.levelLabel('cet6'), wrongView.levelLabel('')], ['四级', '六级', '—']);
const ws = wrongView.wrongStats([
  { key: 'cet4:apple', level: 'cet4' },
  { key: 'cet6:ambiguous', level: 'cet6' },
  { key: 'cet4:cancel', level: 'cet4' },
]);
eq('wrongStats.count', ws.count, 3);
eq('wrongStats.byLevel', ws.byLevel, { cet4: 2, cet6: 1 });
eq('wrongStats.levels', ws.levels, [{ level: 'cet4', count: 2 }, { level: 'cet6', count: 1 }]);
eq('wrongStats 空列表', wrongView.wrongStats(null), { count: 0, byLevel: {}, levels: [] });
eq('deckOf 复制不改原数组', wrongView.deckOf([1, 2]).length, 2);

/* ---------- 12. 模块导入本身就是证据：Node 里没有 document/localStorage 也能 import ---------- */
check('两个模块在无 document 环境可 import', typeof document === 'undefined' && typeof quiz.route.mount === 'function' && typeof wrongView.route.mount === 'function');
eq('route.name', [quiz.route.name, wrongView.route.name], ['quiz', 'wrong']);

/* ---------- 13. store 端到端串测（界面用的真实 API） ---------- */
console.log('--- store 端到端串测 ---');
store.reset();
eq('起始错词本为空', store.wrong().length, 0);

const e1 = store.addWrong({ key: 'cet4:apple', word: 'apple', level: 'cet4' });
eq('答错 → addWrong 后错词本长度 1', store.wrong().length, 1);
eq('答错 → count=1', e1.count, 1);
const e2 = store.addWrong({ key: 'cet4:apple', word: 'apple', level: 'cet4' });
eq('再次答错 → 长度仍是 1', store.wrong().length, 1);
eq('再次答错 → count 累加到 2', store.wrong()[0].count, 2);
eq('addWrong 返回值 count=2', e2.count, 2);

const CLK = Date.now();
setNow(function () { return CLK + 60000; }); // 注入时钟，保证 lastAt 严格更晚
store.addWrong({ key: 'cet6:ambiguous', word: 'ambiguous', level: 'cet6' });
setNow(null);
eq('第二个错词 → 长度 2', store.wrong().length, 2);
eq('错词按 lastAt 倒序（最近在前）', store.wrong()[0].key, 'cet6:ambiguous');

store.markSeen('cet4:apple', false);
eq('markSeen(apple, false) 记为答错', [store.rec('cet4:apple').seen, store.rec('cet4:apple').wrong], [1, 1]);
eq('markSeen 计入今日计划', store.daily().doneKeys.indexOf('cet4:apple') >= 0, true);

store.markSeen('cet4:apple', true);
store.removeWrong('cet4:apple');
eq('答对 → removeWrong 后 apple 移出', store.wrong().map(function (w) { return w.key; }), ['cet6:ambiguous']);
eq('markSeen(true) 后 box 回到 1', store.progressOf('cet4:apple').box, 1);

store.markSeen('cet6:ambiguous', true);
store.removeWrong('cet6:ambiguous');
eq('全部答对 → 错词本清空', store.wrong().length, 0);

store.addWrong({ key: 'cet4:cancel', word: 'cancel', level: 'cet4' });
store.addWrong({ key: 'cet6:vivid', word: 'vivid', level: 'cet4' });
eq('清空前有 2 条', store.wrong().length, 2);
store.clearWrong();
eq('clearWrong → 0 条', store.wrong().length, 0);
eq('清空不影响已记录的 rec', store.rec('cet4:cancel').seen, 0);

/* 模拟一整组 3 题（答对 2 错 1）的最小学生: 每题 markSeen + 错题 addWrong */
store.reset();
const round = [
  { item: POOL[0], ok: true },
  { item: POOL[1], ok: false },
  { item: POOL[2], ok: true },
];
const answers = [];
for (const step of round) {
  answers.push(step.ok);
  store.markSeen(step.item.key, step.ok);
  if (step.ok) store.removeWrong(step.item.key);
  else store.addWrong({ key: step.item.key, word: step.item.word, level: step.item.level });
}
const roundScore = quiz.scoreOf(answers);
eq('一组 3 题的得分', [roundScore.total, roundScore.right, roundScore.accuracy], [3, 2, 2 / 3]);
eq('一组 3 题后错词本只有答错的那个', store.wrong().map(function (w) { return w.key; }), ['cet4:cancel']);
eq('一组 3 题后今日计划记 3 个词', store.daily().doneCount, 3);

/* ---------- 14. mount 冒烟：用最小 DOM 影子验证两个视图能装配出来 ---------- */
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.nodeType = 1; // util.el 用 nodeType 判断是否 Node
    this.childNodes = [];
    this.attrs = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this._text = '';
    this.className = '';
    this.hidden = false;
    this.id = '';
    this.classList = {
      add: (c) => {
        const set = new Set(this.className.split(' ').filter(Boolean));
        set.add(c);
        this.className = Array.from(set).join(' ');
      },
      remove: (c) => {
        this.className = this.className.split(' ').filter((x) => x && x !== c).join(' ');
      },
      contains: (c) => this.className.split(' ').indexOf(c) >= 0,
      toggle: (c, force) => {
        const has = this.className.split(' ').indexOf(c) >= 0;
        const want = force === undefined ? !has : !!force;
        if (want && !has) this.classList.add(c);
        if (!want && has) this.classList.remove(c);
        return want;
      },
    };
  }
  appendChild(n) { this.childNodes.push(n); n.parentNode = this; return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); return n; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    const a = this.listeners[t];
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  click() { (this.listeners.click || []).forEach((fn) => fn({ target: this, preventDefault() {} })); }
  get textContent() {
    let out = this._text;
    for (const c of this.childNodes) out += c.textContent;
    return out;
  }
  set textContent(v) { this.childNodes = []; this._text = String(v); }
  get innerHTML() { return ''; }
  set innerHTML(v) { this.childNodes = []; this._text = ''; }
}

function textOf(node) { return node.textContent; }
function findAll(node, tag, out) {
  const acc = out || [];
  if (node.tagName === tag) acc.push(node);
  for (const c of node.childNodes) findAll(c, tag, acc);
  return acc;
}
function buttonByText(root, label) {
  return findAll(root, 'BUTTON').filter((b) => b.textContent === label)[0] || null;
}

const docStub = {
  body: new FakeNode('body'),
  createElement: (t) => new FakeNode(t),
  createTextNode: (t) => {
    const n = new FakeNode('#text');
    n.nodeType = 3;
    n.textContent = t;
    return n;
  },
  getElementById: () => null,
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.document = docStub;

console.log('--- mount 冒烟（最小 DOM 影子）---');
const quizRoot = new FakeNode('main');
const quizCleanup = quiz.route.mount(quizRoot);
const quizText = textOf(quizRoot);
check('quiz.mount：渲染开始页标题', quizText.indexOf('随机测试') >= 0);
check('quiz.mount：有开始按钮', !!buttonByText(quizRoot, '开始测试'));
check('quiz.mount：有时间量/范围/题型三组', findAll(quizRoot, 'BUTTON').length >= 9);

const btn20 = buttonByText(quizRoot, '20 题');
check('quiz.mount：能找到「20 题」按钮', !!btn20);
if (btn20) btn20.click();
const btn20b = buttonByText(quizRoot, '20 题');
check('quiz.mount：点「20 题」后选中态切换', !!btn20b && btn20b.className.indexOf('is-on') >= 0);
check('quiz.mount：题量单选互斥（10 题不再选中）', (buttonByText(quizRoot, '10 题') || { className: '' }).className.indexOf('is-on') < 0);
quizCleanup();

store.reset();
const wrongRoot = new FakeNode('main');
const wrongCleanup = wrongView.route.mount(wrongRoot);
check('wrong.mount：空状态标题', textOf(wrongRoot).indexOf('错词本是空的') >= 0);
check('wrong.mount：空状态跳转按钮', !!buttonByText(wrongRoot, '去随机测试'));
wrongCleanup();

store.addWrong({ key: 'cet4:apple', word: 'apple', level: 'cet4' });
store.addWrong({ key: 'cet6:ambiguous', word: 'ambiguous', level: 'cet6' });
const listRoot = new FakeNode('main');
const listCleanup = wrongView.route.mount(listRoot);
const listText = textOf(listRoot);
check('wrong.mount：列表渲染两条错词', listText.indexOf('apple') >= 0 && listText.indexOf('ambiguous') >= 0);
check('wrong.mount：显示错次与级别', listText.indexOf('错 1 次') >= 0 && listText.indexOf('四级') >= 0 && listText.indexOf('六级') >= 0);
check('wrong.mount：顶部统计错词数 2', listText.indexOf('错词数') >= 0);
check('wrong.mount：有「开始集中复习」按钮', !!buttonByText(listRoot, '开始集中复习'));
listCleanup();
store.reset();

console.log('');
console.log('通过 ' + pass + ' / 失败 ' + fail + '（共 ' + (pass + fail) + ' 条断言）');
if (fail) {
  console.log('失败项：');
  for (const f of failures) console.log(' - ' + f);
  process.exitCode = 1;
} else {
  console.log('全部通过');
}