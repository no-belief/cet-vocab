/* scripts/selftest-plan-progress.mjs — S4「每日计划 + 学习进度」自测（owner: S4）
 * 用法：
 *   node scripts/selftest-plan-progress.mjs                      纯逻辑 + 端到端数据流
 *   node scripts/selftest-plan-progress.mjs --probe <baseUrl>     起服务后的 HTTP 探针
 */

/* ---------- localStorage shim（必须在 import store 之前） ---------- */
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

const plan = await import('../assets/js/features/plan.js');
const prog = await import('../assets/js/features/progress.js');
const core = await import('../assets/js/core/store.js');
const util = await import('../assets/js/core/util.js');
const store = core.store;

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

/* ---------- HTTP 探针模式 ---------- */
const probeIdx = process.argv.indexOf('--probe');
if (probeIdx > 0) {
  const base = String(process.argv[probeIdx + 1] || '').replace(/\/+$/, '');
  if (!base) {
    console.log('FAIL  缺少 baseUrl，例如：node scripts/selftest-plan-progress.mjs --probe http://127.0.0.1:8125');
    process.exit(1);
  }
  console.log('--- HTTP 探针：' + base + ' ---');

  async function getText(path) {
    const res = await fetch(base + path);
    const text = await res.text();
    return { status: res.status, text: text };
  }

  const index = await getText('/index.html');
  check('/index.html → 200', index.status === 200, 'status ' + index.status);
  check('/index.html 引用了 app.js 模块入口', index.text.indexOf('./assets/js/app.js') >= 0);
  check('/index.html 引用了 plan.css 与 progress.css',
    index.text.indexOf('features/plan.css') >= 0 && index.text.indexOf('features/progress.css') >= 0);

  const abs = index.text.match(/(?:src|href)="\/(?!\/)/g);
  check('/index.html 无 / 开头的绝对资源路径（GitHub Pages 子路径安全）', !abs, 'found ' + JSON.stringify(abs));

  const cet6 = await getText('/data/cet6.json');
  let cet6Words = null;
  try { cet6Words = JSON.parse(cet6.text).words; } catch (e) { cet6Words = null; }
  check('/data/cet6.json → 200', cet6.status === 200, 'status ' + cet6.status);
  check('/data/cet6.json words.length === 3318', Array.isArray(cet6Words) && cet6Words.length === 3318,
    'got ' + (Array.isArray(cet6Words) ? cet6Words.length : 'parse error'));

  const cet4 = await getText('/data/cet4.json');
  let cet4Words = null;
  try { cet4Words = JSON.parse(cet4.text).words; } catch (e) { cet4Words = null; }
  check('/data/cet4.json → 200 且 words.length === 5871', cet4.status === 200 && Array.isArray(cet4Words) && cet4Words.length === 5871,
    'status ' + cet4.status + ', words ' + (Array.isArray(cet4Words) ? cet4Words.length : 'parse error'));

  const manifest = await getText('/data/manifest.json');
  let mf = null;
  try { mf = JSON.parse(manifest.text); } catch (e) { mf = null; }
  check('/data/manifest.json → 200 且 count 与数据一致',
    manifest.status === 200 && !!mf && !!mf.levels && mf.levels.cet4.count === 5871 && mf.levels.cet6.count === 3318);

  for (const path of ['/assets/js/features/plan.js', '/assets/js/features/progress.js']) {
    const r = await getText(path);
    check(path + ' → 200', r.status === 200, 'status ' + r.status);
    check(path + ' 导出了 route', r.text.indexOf('export const route') >= 0);
  }
  for (const path of ['/assets/css/features/plan.css', '/assets/css/features/progress.css']) {
    const r = await getText(path);
    check(path + ' → 200', r.status === 200, 'status ' + r.status);
    check(path + ' 非空（>500 字节）', r.text.length > 500, 'length ' + r.text.length);
  }

  console.log('--- 探针结果：PASS ' + pass + ' / FAIL ' + fail + ' ---');
  if (fail > 0) {
    console.log('失败项：' + failures.join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

/* ---------- 1. clampGoal ---------- */
console.log('--- 1. plan.clampGoal ---');
eq('clampGoal("12") 合法', plan.clampGoal('12'), { value: 12, ok: true, message: '' });
eq('clampGoal("0") 夹到下限 1 且 ok=false', plan.clampGoal('0'), { value: 1, ok: false, message: '每日学习量最小为 1，已按最小值保存' });
eq('clampGoal("abc") 回退默认 20 且 ok=false', plan.clampGoal('abc'), { value: 20, ok: false, message: '每日学习量需要填数字（1–200）' });
eq('clampGoal("abc", 35) 回退调用方给的 35', plan.clampGoal('abc', 35).value, 35);
eq('clampGoal("999") 夹到上限 200', plan.clampGoal('999').value, 200);
check('clampGoal("999") 带提示文案', plan.clampGoal('999').ok === false && plan.clampGoal('999').message.length > 0);
eq('clampGoal("") 空输入回退', plan.clampGoal('').value, 20);
eq('clampGoal("   ") 空白回退', plan.clampGoal('   ').value, 20);
eq('clampGoal(" 25 ") 去空格', plan.clampGoal(' 25 '), { value: 25, ok: true, message: '' });
eq('clampGoal(47) 接受数字（快捷按钮）', plan.clampGoal(47).value, 47);
eq('clampGoal("12.6") 四舍五入', plan.clampGoal('12.6').value, 13);
eq('clampGoal("-3") 夹到 1', plan.clampGoal('-3').value, 1);
eq('clampGoal("200") 边界合法', plan.clampGoal('200'), { value: 200, ok: true, message: '' });
eq('clampGoal("1") 边界合法', plan.clampGoal('1'), { value: 1, ok: true, message: '' });
eq('GOAL_MIN/GOAL_MAX', [plan.GOAL_MIN, plan.GOAL_MAX], [1, 200]);

/* ---------- 2. goalProgress / celebrationText ---------- */
console.log('--- 2. plan.goalProgress / celebrationText ---');
eq('goalProgress(0, 20)', plan.goalProgress(0, 20), { done: 0, goal: 20, remaining: 20, extra: 0, ratio: 0, pct: 0, reached: false });
eq('goalProgress(5, 20)', plan.goalProgress(5, 20), { done: 5, goal: 20, remaining: 15, extra: 0, ratio: 0.25, pct: 25, reached: false });
eq('goalProgress(20, 20) 达标', plan.goalProgress(20, 20), { done: 20, goal: 20, remaining: 0, extra: 0, ratio: 1, pct: 100, reached: true });
eq('goalProgress(25, 20) 超额但 pct 封顶 100', plan.goalProgress(25, 20), { done: 25, goal: 20, remaining: 0, extra: 5, ratio: 1, pct: 100, reached: true });
eq('goalProgress(3, 0) goal 兜底为 1', plan.goalProgress(3, 0).goal, 1);
eq('goalProgress("x", "y") 非法输入不炸', plan.goalProgress('x', 'y'), { done: 0, goal: 20, remaining: 20, extra: 0, ratio: 0, pct: 0, reached: false });
eq('goalProgress ratio 与 fmtPct 一致', util.fmtPct(plan.goalProgress(5, 20).ratio), '25%');
check('celebrationText(3, 20) 未达标为空串', plan.celebrationText(3, 20) === '');
check('celebrationText(20, 20) 含「达成」', plan.celebrationText(20, 20).indexOf('达成') >= 0);
check('celebrationText(25, 20) 含「超额」', plan.celebrationText(25, 20).indexOf('超额') >= 0);

/* ---------- 3. dayLabel ---------- */
console.log('--- 3. plan.dayLabel ---');
eq('dayLabel(2025-03-10)', plan.dayLabel(new Date(2025, 2, 10)), '2025年3月10日 周一');
eq('dayLabel(2025-01-01)', plan.dayLabel(new Date(2025, 0, 1)), '2025年1月1日 周三');
eq('dayLabel(2024-02-29 闰日)', plan.dayLabel(new Date(2024, 1, 29)), '2024年2月29日 周四');
eq('dayLabel(2025-12-31)', plan.dayLabel(new Date(2025, 11, 31)), '2025年12月31日 周三');
eq('dayLabel("bad") 非法值返回空串', plan.dayLabel('bad'), '');
check('dayLabel() 默认今天非空', plan.dayLabel().length > 8);

/* ---------- 4. splitKey / foldRows ---------- */
console.log('--- 4. plan.splitKey / foldRows ---');
eq('splitKey("cet4:cancel")', plan.splitKey('cet4:cancel'), { level: 'cet4', word: 'cancel' });
eq('splitKey("cancel")', plan.splitKey('cancel'), { level: '', word: 'cancel' });
eq('splitKey("")', plan.splitKey(''), { level: '', word: '' });
eq('splitKey(null)', plan.splitKey(null), { level: '', word: '' });
eq('progress.splitKey 与 plan 一致', prog.splitKey('cet6:gamma'), plan.splitKey('cet6:gamma'));

const keys45 = Array.from({ length: 45 }, function (_, i) { return 'k' + i; });
const folded = plan.foldRows(keys45, false);
eq('foldRows 45 条未展开 → 只显示 30 条', [folded.shown.length, folded.hidden, folded.total, folded.truncated], [30, 15, 45, true]);
eq('foldRows 展开 → 全部显示', [plan.foldRows(keys45, true).shown.length, plan.foldRows(keys45, true).truncated], [45, false]);
eq('foldRows 30 条正好不需要折叠', plan.foldRows(keys45.slice(0, 30), false).truncated, false);
eq('foldRows 空数组', plan.foldRows([], false), { shown: [], hidden: 0, total: 0, truncated: false });
eq('foldRows(null) 容错', plan.foldRows(null, false).total, 0);
eq('LIST_LIMIT 为 30', plan.LIST_LIMIT, 30);

/* ---------- 5. bucketOf ---------- */
console.log('--- 5. progress.bucketOf ---');
eq('bucketOf 完整 stats 原样收敛',
  prog.bucketOf({ total: 100, seen: 10, mastered: 4, learning: 6, untouched: 90, accuracy: 0.5 }),
  { total: 100, seen: 10, mastered: 4, learning: 6, untouched: 90 });
eq('bucketOf 缺 untouched 时用 total-seen 兜底', prog.bucketOf({ total: 10, seen: 3 }), { total: 10, seen: 3, mastered: 0, learning: 0, untouched: 7 });
eq('bucketOf({})', prog.bucketOf({}), { total: 0, seen: 0, mastered: 0, learning: 0, untouched: 0 });
eq('bucketOf(undefined)', prog.bucketOf(undefined), { total: 0, seen: 0, mastered: 0, learning: 0, untouched: 0 });
eq('bucketOf 脏数据不炸', prog.bucketOf({ total: 'x', seen: -3, mastered: 99, learning: null }).untouched, 0);

/* ---------- 6. stackPercents ---------- */
console.log('--- 6. progress.stackPercents ---');
eq('stackPercents({4,6,90})', prog.stackPercents({ mastered: 4, learning: 6, untouched: 90 }), { mastered: 4, learning: 6, untouched: 90, total: 100 });
eq('stackPercents 全 0', prog.stackPercents({ mastered: 0, learning: 0, untouched: 0 }), { mastered: 0, learning: 0, untouched: 0, total: 0 });
eq('stackPercents(undefined)', prog.stackPercents(undefined), { mastered: 0, learning: 0, untouched: 0, total: 0 });
eq('stackPercents({0,0,3})', prog.stackPercents({ mastered: 0, learning: 0, untouched: 3 }), { mastered: 0, learning: 0, untouched: 100, total: 3 });
eq('stackPercents({1,0,2}) 零段保持 0%', prog.stackPercents({ mastered: 1, learning: 0, untouched: 2 }), { mastered: 33, learning: 0, untouched: 67, total: 3 });
eq('stackPercents({1,1,1})', prog.stackPercents({ mastered: 1, learning: 1, untouched: 1 }), { mastered: 34, learning: 33, untouched: 33, total: 3 });
eq('stackPercents({1,2,0}) 零段保持 0%', prog.stackPercents({ mastered: 1, learning: 2, untouched: 0 }), { mastered: 33, learning: 67, untouched: 0, total: 3 });

let sumOk = true;
let zeroOk = true;
let combos = 0;
for (let m = 0; m <= 6; m++) {
  for (let l = 0; l <= 6; l++) {
    for (let u = 0; u <= 6; u++) {
      const total = m + l + u;
      const r = prog.stackPercents({ mastered: m, learning: l, untouched: u });
      combos += 1;
      if (total > 0 && r.mastered + r.learning + r.untouched !== 100) sumOk = false;
      if (total === 0 && (r.mastered || r.learning || r.untouched)) sumOk = false;
      if (m === 0 && r.mastered !== 0) zeroOk = false;
      if (l === 0 && r.learning !== 0) zeroOk = false;
      if (u === 0 && r.untouched !== 0) zeroOk = false;
    }
  }
}
check('stackPercents 穷举 ' + combos + ' 组：非空合计恒为 100', sumOk);
check('stackPercents 穷举：计数为 0 的段恒为 0%', zeroOk);
const big = prog.stackPercents({ mastered: 137, learning: 412, untouched: 5322 });
check('stackPercents 大规模（137/412/5322）合计 100', big.mastered + big.learning + big.untouched === 100);
console.log('      大规模结果 = ' + JSON.stringify(big));

/* ---------- 7. sortLearned ---------- */
console.log('--- 7. progress.sortLearned ---');
const rows = [
  { id: 'a', word: 'bravo', mastery: 40, last: 100 },
  { id: 'b', word: 'alpha', mastery: 10, last: 300 },
  { id: 'c', word: 'charlie', mastery: 40, last: 200 },
  { id: 'd', word: 'delta', mastery: 90, last: 400 },
];
const ids = function (arr) { return arr.map(function (r) { return r.id; }).join(''); };
eq('掌握度升序', ids(prog.sortLearned(rows, 'mastery', 'asc')), 'bacd');
eq('掌握度降序', ids(prog.sortLearned(rows, 'mastery', 'desc')), 'dacb');
check('掌握度同值保持原始顺序（稳定排序：a 仍在 c 前）', ids(prog.sortLearned(rows, 'mastery', 'asc')) === 'bacd' && ids(prog.sortLearned(rows, 'mastery', 'desc')) === 'dacb');
eq('最近学习 新→旧', ids(prog.sortLearned(rows, 'recent', 'desc')), 'dbca');
eq('最近学习 旧→新', ids(prog.sortLearned(rows, 'recent', 'asc')), 'acbd');
eq('单词 A→Z', ids(prog.sortLearned(rows, 'word', 'asc')), 'bacd');
eq('缺省 dir：mastery 默认升序', ids(prog.sortLearned(rows, 'mastery')), 'bacd');
eq('缺省 dir：recent 默认降序', ids(prog.sortLearned(rows, 'recent')), 'dbca');
eq('未知 key 收敛为 mastery', ids(prog.sortLearned(rows, 'bogus', 'asc')), 'bacd');
eq('空数组', prog.sortLearned([], 'mastery', 'asc'), []);
eq('不修改入参顺序', ids(rows), 'abcd');
check('sortLearned 返回新数组', prog.sortLearned(rows, 'mastery', 'asc') !== rows);

/* ---------- 8. filterRows ---------- */
console.log('--- 8. progress.filterRows ---');
const frows = [
  { word: 'cancel', meanings: ['取消，撤销', '删去'] },
  { word: 'budget', meanings: ['预算'] },
];
eq('按单词大小写无关匹配', prog.filterRows(frows, 'CAN').map(function (r) { return r.word; }), ['cancel']);
eq('按释义匹配', prog.filterRows(frows, '预算').map(function (r) { return r.word; }), ['budget']);
eq('空查询返回全部', prog.filterRows(frows, '').length, 2);
eq('空白查询返回全部', prog.filterRows(frows, '   ').length, 2);
eq('无匹配返回空', prog.filterRows(frows, 'zzz').length, 0);
eq('filterRows(null) 容错', prog.filterRows(null, 'a').length, 0);

/* ---------- 9. progressFromRec / progressRow / legend ---------- */
console.log('--- 9. progress.progressFromRec / progressRow / legend ---');
eq('progressFromRec 未学', prog.progressFromRec({ seen: 0, box: 0 }), { box: 0, mastery: 0, state: 'new' });
eq('progressFromRec box=4 → mastered', prog.progressFromRec({ seen: 2, box: 4 }), { box: 4, mastery: 80, state: 'mastered' });
eq('progressFromRec box=3 → learning', prog.progressFromRec({ seen: 2, box: 3 }), { box: 3, mastery: 60, state: 'learning' });
eq('progressFromRec box 超界夹到 5', prog.progressFromRec({ seen: 1, box: 9 }), { box: 5, mastery: 100, state: 'mastered' });
eq('progressFromRec(null) 容错', prog.progressFromRec(null), { box: 0, mastery: 0, state: 'new' });
eq('MASTERED_BOX === 4 与 store 规则一致', prog.MASTERED_BOX, 4);
eq('BOX_PCT 阶梯', prog.BOX_PCT, [0, 20, 40, 60, 80, 100]);

const row = prog.progressRow({
  key: 'cet4:cancel',
  word: { word: 'cancel', ipa: 'ˈkænsl', meanings: ['取消，撤销', '删去'], pos: 'vt.', example: null },
  rec: { seen: 3, box: 2 },
  progress: prog.progressFromRec({ seen: 3, box: 2 }),
  last: 1741581600000,
});
eq('progressRow 字段', [row.key, row.level, row.word, row.ipa, row.box, row.mastery, row.state, row.last],
  ['cet4:cancel', 'cet4', 'cancel', 'ˈkænsl', 2, 40, 'learning', 1741581600000]);
eq('progressRow 释义', row.meanings, ['取消，撤销', '删去']);
const fallbackRow = prog.progressRow({ key: 'cet4:zeta' });
eq('progressRow 词库缺失时降级为 key 里的单词', [fallbackRow.word, fallbackRow.ipa, fallbackRow.meanings.length], ['zeta', '', 0]);

const legend = prog.masteryLegend();
eq('masteryLegend 6 级', legend.map(function (it) { return it.pct; }), [0, 20, 40, 60, 80, 100]);
eq('masteryLegend 从 box 4 起算已掌握', legend.map(function (it) { return it.mastered; }), [false, false, false, false, true, true]);
eq('fmtDay 时间戳 → YYYY-MM-DD', prog.fmtDay(new Date(2025, 2, 10, 15, 30, 0).getTime()), '2025-03-10');
eq('fmtDay(0) 空串', prog.fmtDay(0), '');
eq('fmtDay(null) 空串', prog.fmtDay(null), '');

/* ---------- 10. 端到端数据流（真实 store API） ---------- */
console.log('--- 10. 端到端数据流（store 真实 API） ---');
const setNow = core.__setNowForTest;
const BASE = new Date(2025, 2, 10, 9, 0, 0).getTime();
setNow(function () { return BASE; });
store.reset();

const goalRes = store.setDailyGoal(20);
check('setDailyGoal(20) 返回 daily 且 goal=20', goalRes.goal === 20 && goalRes.doneCount === 0);

store.markSeen('cet4:alpha', true);
store.markSeen('cet4:beta', false);
store.markSeen('cet6:gamma', true);

const d = store.daily();
check('daily().doneCount === 3（同一天 3 个不同 key）', d.doneCount === 3, 'got ' + d.doneCount);
check('daily().doneKeys 长度 3', d.doneKeys.length === 3, JSON.stringify(d.doneKeys));
check('daily().goal 保持 20', d.goal === 20, 'got ' + d.goal);
check('daily().date 是今天（本地）', d.date === '2025-03-10', 'got ' + d.date);
eq('dayLabel 与 daily().date 同日', plan.dayLabel(new Date(BASE)), '2025年3月10日 周一');
eq('视图展示用 goalProgress(doneCount, goal)', [plan.goalProgress(d.doneCount, d.goal).pct, plan.goalProgress(d.doneCount, d.goal).remaining], [15, 17]);

const st4 = store.stats('cet4', 5871);
eq('stats 字段集合 = 视图渲染用到的字段',
  Object.keys(st4).sort(),
  ['accuracy', 'learning', 'mastered', 'seen', 'total', 'untouched']);
check('stats("cet4", 5871).total === 5871', st4.total === 5871, 'got ' + st4.total);
check('stats("cet4", 5871).seen === 2', st4.seen === 2, 'got ' + st4.seen);
check('stats("cet4", 5871).learning === 2', st4.learning === 2, 'got ' + st4.learning);
check('stats("cet4", 5871).mastered === 0', st4.mastered === 0, 'got ' + st4.mastered);
check('stats("cet4", 5871).untouched === 5869', st4.untouched === 5869, 'got ' + st4.untouched);
check('stats.accuracy 是 0..1 小数（0.5）', st4.accuracy === 0.5, 'got ' + st4.accuracy);
eq('fmtPct(stats.accuracy) 展示为 50%', util.fmtPct(st4.accuracy), '50%');
eq('bucketOf(store.stats) 与 stats 计数一致', prog.bucketOf(st4), { total: 5871, seen: 2, mastered: 0, learning: 2, untouched: 5869 });

const stAll = store.stats(null, { cet4: 5871, cet6: 3318 });
eq('聚合 stats(null, totals) 计数', [stAll.total, stAll.seen, stAll.mastered, stAll.learning, stAll.untouched], [9189, 3, 0, 3, 9186]);
check('聚合 accuracy = 2/3 ≈ 0.667', stAll.accuracy === 0.667, 'got ' + stAll.accuracy);
eq('fmtPct(聚合 accuracy)', util.fmtPct(stAll.accuracy), '67%');
const allPct = prog.stackPercents(prog.bucketOf(stAll));
check('聚合堆叠条合计 100', allPct.mastered + allPct.learning + allPct.untouched === 100, JSON.stringify(allPct));

store.markSeen('cet4:alpha', true);
check('同一天重复 markSeen 不重复计入 doneKeys', store.daily().doneCount === 3, 'got ' + store.daily().doneCount);

store.markSeen('cet4:alpha', true);
store.markSeen('cet4:alpha', true);
eq('alpha 答对 4 次 → box 4', store.rec('cet4:alpha').box, 4);
eq('box=4 → store.progressOf state=mastered', store.progressOf('cet4:alpha').state, 'mastered');

let sameRule = true;
const sampleKeys = ['cet4:alpha', 'cet4:beta', 'cet6:gamma', 'cet4:never-seen'];
for (let i = 0; i < sampleKeys.length; i++) {
  const a = JSON.stringify(store.progressOf(sampleKeys[i]));
  const b = JSON.stringify(prog.progressFromRec(store.rec(sampleKeys[i])));
  if (a !== b) sameRule = false;
}
check('progressFromRec 与 store.progressOf 口径一致（4 个样本）', sameRule);
eq('alpha 已学 → 列表中 state=mastered / mastery=80',
  [(function () { const r = prog.progressRow({ key: 'cet4:alpha', rec: store.rec('cet4:alpha'), progress: prog.progressFromRec(store.rec('cet4:alpha')) }); return r.state + ':' + r.mastery; })()],
  ['mastered:80']);

const stAfter = store.stats('cet4', 5871);
check('再答对后 mastered 变为 1', stAfter.mastered === 1, 'got ' + stAfter.mastered);
check('accuracy 随练习变化且仍在 0..1', stAfter.accuracy > 0 && stAfter.accuracy <= 1, 'got ' + stAfter.accuracy);

/* 重置入口走的是 store.reset() */
store.reset();
check('store.reset() 后 daily().doneCount === 0', store.daily().doneCount === 0);
check('store.reset() 后 daily().goal 回到默认 20', store.daily().goal === 20, 'got ' + store.daily().goal);
check('store.reset() 后 stats 全空', (function () { const s = store.stats(null, { cet4: 5871, cet6: 3318 }); return s.seen === 0 && s.mastered === 0 && s.accuracy === 0; })());
setNow(null);

/* ---------- 11. mount() DOM 装配冒烟（最小 DOM shim，无第三方依赖） ---------- */
console.log('--- 11. mount() DOM 装配冒烟（最小 DOM shim） ---');

function installDom() {
  const docListeners = {};
  function textNode(text) {
    return { nodeType: 3, textContent: String(text), childNodes: [], parentNode: null };
  }
  function element(tag) {
    const node = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      childNodes: [],
      parentNode: null,
      attrs: {},
      listeners: {},
      dataset: {},
      style: {},
      className: '',
      textContent: '',
      value: '',
      hidden: false,
      appendChild(child) { child.parentNode = node; node.childNodes.push(child); return child; },
      removeChild(child) {
        const i = node.childNodes.indexOf(child);
        if (i >= 0) node.childNodes.splice(i, 1);
        child.parentNode = null;
        return child;
      },
      setAttribute(k, v) { node.attrs[String(k)] = String(v); },
      getAttribute(k) {
        const kk = String(k);
        return Object.prototype.hasOwnProperty.call(node.attrs, kk) ? node.attrs[kk] : null;
      },
      removeAttribute(k) { delete node.attrs[String(k)]; },
      addEventListener(type, fn) { (node.listeners[type] = node.listeners[type] || []).push(fn); },
      removeEventListener(type, fn) {
        const a = node.listeners[type] || [];
        const i = a.indexOf(fn);
        if (i >= 0) a.splice(i, 1);
      },
      dispatch(type, ev) {
        (node.listeners[type] || []).slice().forEach(function (fn) { fn(ev || { preventDefault: function () {} }); });
      },
    };
    node.classList = {
      _set() { return new Set(String(node.className || '').split(/\s+/).filter(Boolean)); },
      add(c) { const s = this._set(); s.add(c); node.className = Array.from(s).join(' '); },
      remove(c) { const s = this._set(); s.delete(c); node.className = Array.from(s).join(' '); },
      contains(c) { return this._set().has(c); },
      toggle(c, force) {
        const on = force === undefined ? !this._set().has(c) : !!force;
        if (on) this.add(c);
        else this.remove(c);
        return on;
      },
    };
    let inner = '';
    Object.defineProperty(node, 'innerHTML', {
      configurable: true,
      get() { return inner; },
      set(v) { inner = String(v); node.childNodes.length = 0; },
    });
    return node;
  }

  const toastHost = element('div');
  const doc = {
    createElement: element,
    createTextNode: textNode,
    getElementById(id) { return String(id) === 'toast-host' ? toastHost : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const a = docListeners[type] || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    body: element('body'),
    documentElement: element('html'),
    visibilityState: 'visible',
    title: '',
  };
  doc.body.appendChild(toastHost);
  globalThis.document = doc;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  return doc;
}

function walk(node, out) {
  if (!node) return out;
  out.push(node);
  const kids = node.childNodes || [];
  for (let i = 0; i < kids.length; i++) walk(kids[i], out);
  return out;
}

function byClass(root, cls) {
  return walk(root, []).filter(function (n) {
    return n.nodeType === 1 && String(n.className || '').split(/\s+/).indexOf(cls) >= 0;
  });
}

function textOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent;
  let s = node.textContent || '';
  const kids = node.childNodes || [];
  for (let i = 0; i < kids.length; i++) s += textOf(kids[i]);
  return s;
}

function buttonsIn(container) {
  return walk(container, []).filter(function (n) { return n.nodeType === 1 && n.tagName === 'BUTTON'; });
}

function buttonIn(container, text) {
  if (!container) return null;
  const list = buttonsIn(container).filter(function (n) { return textOf(n).indexOf(text) >= 0; });
  return list.length ? list[0] : null;
}

function box(className) {
  return byClass(planRoot, className)[0] || null;
}

installDom();
store.reset();
store.setDailyGoal(20);

const planRoot = document.createElement('div');
let planCleanup = null;
let planMounted = true;
try {
  planCleanup = plan.route.mount(planRoot);
} catch (e) {
  planMounted = false;
  console.log('      plan.mount 抛错：' + String(e && e.message));
}
check('plan.mount() 不抛错', planMounted);
check('plan 渲染出 3 个 .panel', byClass(planRoot, 'panel').length === 3, String(byClass(planRoot, 'panel').length));

const goalInput = byClass(planRoot, 'plan-goal__input')[0];
check('每日学习量输入框初值 = 当前 goal', !!goalInput && goalInput.value === '20', goalInput ? goalInput.value : 'missing');
check('输入框 type=number 且 min=1 / max=200',
  !!goalInput && goalInput.getAttribute('type') === 'number' && goalInput.getAttribute('min') === '1' && goalInput.getAttribute('max') === '200');

const todayCount = byClass(planRoot, 'plan-today__count')[0];
check('今日卡显示「今日完成 0 / 20 词」', textOf(todayCount).replace(/\s+/g, '') === '今日完成0/20词', textOf(todayCount));
check('今日卡有 .progress 与进度条', byClass(planRoot, 'progress').length === 1 && byClass(planRoot, 'progress__bar').length === 1);
check('进度条初始宽度 0%', byClass(planRoot, 'progress__bar')[0].style.width === '0%');
check('进度条 aria-valuenow = 0', byClass(planRoot, 'progress')[0].getAttribute('aria-valuenow') === '0');

check('快捷按钮 10/20/30/50 都在',
  ['10', '20', '30', '50'].every(function (t) { return !!buttonIn(box('plan-goal__quick'), t); }) && buttonsIn(box('plan-goal__quick')).length === 4,
  String(buttonsIn(box('plan-goal__quick')).length) + ' 个按钮');
const quick50 = buttonIn(box('plan-goal__quick'), '50');
quick50.dispatch('click');
check('点「50」把 goal 写成 50', store.daily().goal === 50, String(store.daily().goal));
check('今日卡随 goal 更新为 / 50 词', textOf(todayCount).indexOf('/ 50 ' + '词') >= 0, textOf(todayCount));

const saveBtn = buttonIn(box('plan-goal__row'), '保存');
goalInput.value = 'abc';
saveBtn.dispatch('click');
check('非法输入（abc）回落为当前 goal 并给提示',
  store.daily().goal === 50 && textOf(byClass(planRoot, 'plan__hint')[0]).length > 0,
  'goal=' + store.daily().goal + ' hint=' + textOf(byClass(planRoot, 'plan__hint')[0]));
check('非法输入提示带警示样式', byClass(planRoot, 'plan__hint--warn').length === 1);
goalInput.value = '0';
saveBtn.dispatch('click');
check('输入 0 夹到 1', store.daily().goal === 1, String(store.daily().goal));
quick50.dispatch('click');

store.markSeen('cet4:alpha', true);
store.markSeen('cet4:beta', false);
check('今日清单渲染 2 行 .plan-word', byClass(planRoot, 'plan-word').length === 2, String(byClass(planRoot, 'plan-word').length));
const listTitle = byClass(planRoot, 'plan__title')[2];
check('清单标题带数量', textOf(listTitle).indexOf('2 个词') >= 0, textOf(listTitle));
check('进度条宽度随完成数变化', byClass(planRoot, 'progress__bar')[0].style.width === '4%', byClass(planRoot, 'progress__bar')[0].style.width);
check('未达标不显示庆祝文案', byClass(planRoot, 'plan-today__cheer')[0].hidden === true);

for (let i = 0; i < 31; i++) store.markPlannedDone('cet4:fill' + i);
check('超过 30 条折叠为 30 行', byClass(planRoot, 'plan-word').length === 30, String(byClass(planRoot, 'plan-word').length));
check('出现「展开全部」按钮', !!buttonIn(box('plan-list__more'), '展开全部'));
buttonIn(box('plan-list__more'), '展开全部').dispatch('click');
check('展开后渲染全部 33 行', byClass(planRoot, 'plan-word').length === 33, String(byClass(planRoot, 'plan-word').length));
check('展开后按钮变「收起」', !!buttonIn(box('plan-list__more'), '收起'));

let ctaOk = true;
try {
  byClass(planRoot, 'plan-cta')[0].dispatch('click');
  byClass(planRoot, 'plan-links')[0].childNodes[0].dispatch('click');
  byClass(planRoot, 'plan-links')[0].childNodes[1].dispatch('click');
} catch (e) {
  ctaOk = false;
  console.log('      CTA 点击抛错：' + String(e && e.message));
}
check('主 CTA「开始今日学习」与两个二级入口点击不抛错', ctaOk && textOf(byClass(planRoot, 'plan-cta')[0]) === '开始今日学习');
if (typeof planCleanup === 'function') planCleanup();

const progRoot = document.createElement('div');
let progCleanup = null;
let progMounted = true;
try {
  progCleanup = prog.route.mount(progRoot);
} catch (e) {
  progMounted = false;
  console.log('      progress.mount 抛错：' + String(e && e.message));
}
check('progress.mount() 不抛错', progMounted);
await new Promise(function (resolve) { setTimeout(resolve, 0); });
check('总览渲染 5 个 .stat', byClass(progRoot, 'stat').length === 5, String(byClass(progRoot, 'stat').length));
const statNums = byClass(progRoot, 'stat__num').map(textOf);
check('已学词数 = 2（cet4:alpha / cet4:beta）', statNums[0] === '2', statNums.join(','));
check('已掌握 = 0（box 都 < 4）', statNums[1] === '0', statNums.join(','));
check('学习中 = 2', statNums[2] === '2', statNums.join(','));
check('正确率按 0..1 → 百分比展示（50%）', statNums[4] === '50%', statNums.join(','));
check('每个级别一条堆叠条（2 条）', byClass(progRoot, 'pbar').length === 2, String(byClass(progRoot, 'pbar').length));
check('总量未知时仍渲染学习中色块（100%）',
  byClass(progRoot, 'pbar__seg--learning').length === 1 && byClass(progRoot, 'pbar__seg--learning')[0].style.width === '100%',
  String(byClass(progRoot, 'pbar__seg').length) + ' 段');
check('单词级列表 2 行', byClass(progRoot, 'pw-row').length === 2, String(byClass(progRoot, 'pw-row').length));
check('每行 5 格 box 方块', byClass(progRoot, 'pw-row')[0] && byClass(byClass(progRoot, 'pw-row')[0], 'pw-box__cell').length === 5);
check('列表提示含已学/未学词数', textOf(byClass(progRoot, 'pv-hint')[1]).indexOf('已学 2 词') >= 0, textOf(byClass(progRoot, 'pv-hint')[1]));
check('图例 6 级（0/20/40/60/80/100%）', byClass(progRoot, 'pv-legend__item').length >= 8, String(byClass(progRoot, 'pv-legend__item').length));

const search = byClass(progRoot, 'pv-search')[0];
search.value = 'alpha';
search.dispatch('input');
check('搜索 alpha 只剩 1 行', byClass(progRoot, 'pw-row').length === 1, String(byClass(progRoot, 'pw-row').length));
search.value = '不存在的词';
search.dispatch('input');
check('搜索无命中显示 empty 占位', byClass(progRoot, 'empty').length >= 1 && byClass(progRoot, 'pw-row').length === 0);
search.value = '';
search.dispatch('input');
check('清空搜索恢复 2 行', byClass(progRoot, 'pw-row').length === 2, String(byClass(progRoot, 'pw-row').length));

const sortSel = byClass(progRoot, 'pv-sort')[0];
sortSel.value = 'recent:desc';
let sortOk = true;
try { sortSel.dispatch('change'); } catch (e) { sortOk = false; }
check('切换排序不抛错', sortOk);
const levelSel = byClass(progRoot, 'pv-level-select')[0];
levelSel.value = 'cet4';
let levelOk = true;
try { levelSel.dispatch('change'); } catch (e) { levelOk = false; }
check('切换级别筛选不抛错且只显示 1 条堆叠条', levelOk && byClass(progRoot, 'pbar').length === 1, String(byClass(progRoot, 'pbar').length));
levelSel.value = 'all';
levelSel.dispatch('change');

check('重置按钮存在且为 btn--danger', !!byClass(progRoot, 'pv-reset__btn')[0] && byClass(progRoot, 'pv-reset__btn')[0].className.indexOf('btn--danger') >= 0);
byClass(progRoot, 'pv-reset__btn')[0].dispatch('click');
check('第一次点击进入二次确认', byClass(progRoot, 'pv-warn').length === 1);
buttonIn(byClass(progRoot, 'pv-reset__row')[0], '确认重置').dispatch('click');
check('确认重置后学习数据清空', store.daily().doneCount === 0 && store.stats(null, { cet4: 5871, cet6: 3318 }).seen === 0);
check('重置后列表回到 empty 占位', byClass(progRoot, 'pw-row').length === 0 && byClass(progRoot, 'empty').length >= 1,
  'rows=' + byClass(progRoot, 'pw-row').length + ' empty=' + byClass(progRoot, 'empty').length + ' hint=' + textOf(byClass(progRoot, 'pv-hint')[1]));
check('重置后已学词数归零', byClass(progRoot, 'stat__num')[0].textContent === '0');
if (typeof progCleanup === 'function') progCleanup();
store.reset();

/* ---------- 汇总 ---------- */
console.log('--- 结果：PASS ' + pass + ' / FAIL ' + fail + ' ---');
if (fail > 0) {
  console.log('失败项：' + failures.join(' | '));
  process.exit(1);
}
process.exit(0);
