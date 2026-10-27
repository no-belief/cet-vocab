/* scripts/selftest-core.mjs — core/store.js 自测（不进页面，owner: S2）
 * 用法：node scripts/selftest-core.mjs
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

const core = await import('../assets/js/core/store.js');
const store = core.store;
const setNow = core.__setNowForTest;

const DAY = 86400000;
const BASE = new Date(2025, 2, 10, 9, 0, 0).getTime(); // 本地 2025-03-10 09:00
let clock = BASE;
setNow(function () { return clock; });

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

function throws(name, fn) {
  let thrown = null;
  try { fn(); } catch (e) { thrown = e; }
  check(name, !!thrown && thrown instanceof Error, thrown ? 'threw non-Error' : 'did not throw');
}

console.log('--- store.js 自测 ---');

/* ---------- 1. settings ---------- */
store.reset();
eq('settings 默认值', store.settings(), { level: 'cet4', dailyGoal: 20, quizSize: 10 });
eq('updateSettings 合并', store.updateSettings({ level: 'cet6', dailyGoal: 35 }), { level: 'cet6', dailyGoal: 35, quizSize: 10 });
eq('updateSettings 只改一项', store.updateSettings({ quizSize: 15 }), { level: 'cet6', dailyGoal: 35, quizSize: 15 });
eq('updateSettings 非法 level 忽略', store.updateSettings({ level: 'cet8' }).level, 'cet6');
eq('updateSettings dailyGoal 夹取下界', store.updateSettings({ dailyGoal: -5 }).dailyGoal, 1);
eq('updateSettings dailyGoal 夹取上界', store.updateSettings({ dailyGoal: 99999 }).dailyGoal, 1000);
store.reset();

/* ---------- 2. box / mastery / state ---------- */
eq('rec 默认值', store.rec('cet4:never'), { seen: 0, right: 0, wrong: 0, box: 0, last: 0, due: 0 });
eq('progressOf 新词 state=new', store.progressOf('cet4:never'), { box: 0, mastery: 0, state: 'new' });

for (let i = 0; i <= 5; i++) {
  const key = 'cet4:box' + i;
  for (let n = 0; n < i; n++) store.markSeen(key, true);
  const p = store.progressOf(key);
  eq('mastery box=' + i + ' → ' + (i * 20), [p.box, p.mastery], [i, i * 20]);
}

const clampKey = 'cet4:clamp';
for (let n = 0; n < 8; n++) store.markSeen(clampKey, true);
eq('答对 8 次后 box 夹取到 5', store.rec(clampKey).box, 5);
eq('box=5 → mastery 100', store.progressOf(clampKey).mastery, 100);
eq('box>=4 → state=mastered', store.progressOf(clampKey).state, 'mastered');
store.markSeen(clampKey, false);
eq('答错一次 box 5→4（仍 mastered）', store.rec(clampKey).box, 4);
store.markSeen(clampKey, false);
eq('再答错 box 4→3 → learning', [store.rec(clampKey).box, store.progressOf(clampKey).state], [3, 'learning']);

const floorKey = 'cet4:floor';
store.markSeen(floorKey, false);
store.markSeen(floorKey, false);
eq('答错时 box 不下穿 0', store.rec(floorKey).box, 0);
eq('答错计数 seen/wrong', [store.rec(floorKey).seen, store.rec(floorKey).wrong, store.rec(floorKey).right], [2, 2, 0]);
eq('state=learning（seen>0, box<4）', store.progressOf(floorKey).state, 'learning');

/* ---------- 3. due 阶梯 ---------- */
store.reset();
const dueSteps = [0, 1, 2, 4, 7, 15];
eq('box=0 答错 → due=now', (function () {
  clock = BASE;
  store.markSeen('cet4:d0', false);
  return store.rec('cet4:d0').due - BASE;
})(), dueSteps[0] * DAY);
for (let box = 1; box <= 5; box++) {
  clock = BASE;
  const key = 'cet4:d' + box;
  for (let n = 0; n < box; n++) store.markSeen(key, true);
  eq('box=' + box + ' → due=now+' + dueSteps[box] + '天', store.rec(key).due - BASE, dueSteps[box] * DAY);
}

/* ---------- 4. 当日计划 ---------- */
store.reset();
clock = BASE;
store.markSeen('cet4:daily1', true);
store.markSeen('cet4:daily1', true);
store.markSeen('cet4:daily1', false);
eq('同一天同一 key 去重（markSeen ×3 → 1 项）', store.daily().doneKeys, ['cet4:daily1']);
eq('doneCount 与 doneKeys 一致', store.daily().doneCount, 1);
store.markPlannedDone('cet4:daily1');
eq('markPlannedDone 幂等', store.daily().doneKeys.length, 1);
store.markPlannedDone('cet4:daily2');
eq('markPlannedDone 新增', store.daily().doneKeys.length, 2);
eq('setDailyGoal', store.setDailyGoal(33).goal, 33);
eq('daily.goal 独立于 settings.dailyGoal', store.settings().dailyGoal, 20);

clock = BASE + DAY; // 跨天
const nextDay = store.daily();
eq('跨天 doneKeys 归零', nextDay.doneKeys.length, 0);
eq('跨天 goal 保留', nextDay.goal, 33);
eq('跨天 date 切换', nextDay.date, '2025-03-11');
store.markPlannedDone('cet4:daily3');
eq('新的一天重新计数', store.daily().doneKeys, ['cet4:daily3']);
clock = BASE;

/* ---------- 5. 错词本 ---------- */
store.reset();
clock = BASE;
store.addWrong({ key: 'cet4:w1', word: 'w1', level: 'cet4' });
clock = BASE + 1000;
store.addWrong({ key: 'cet4:w2', word: 'w2', level: 'cet4' });
clock = BASE + 2000;
store.addWrong({ key: 'cet4:w1', word: 'w1', level: 'cet4' });
const wrongList = store.wrong();
eq('wrong 长度', wrongList.length, 2);
eq('wrong 按 lastAt 倒序', wrongList.map(function (w) { return w.key; }), ['cet4:w1', 'cet4:w2']);
eq('wrong 重复出现 count++', wrongList[0].count, 2);
eq('wrong firstAt 保持首次', wrongList[0].firstAt, BASE);
eq('wrong lastAt 刷新', wrongList[0].lastAt, BASE + 2000);
eq('removeWrong', store.removeWrong('cet4:w1').map(function (w) { return w.key; }), ['cet4:w2']);
eq('clearWrong', store.clearWrong(), []);
eq('clearWrong 后为空', store.wrong().length, 0);

/* ---------- 6. stats ---------- */
store.reset();
for (let n = 0; n < 4; n++) store.markSeen('cet4:m0', true); // box4 mastered
store.markSeen('cet4:m1', false); // learning
store.markSeen('cet6:k0', true); // learning
eq('stats(level, total)', store.stats('cet4', 10), { total: 10, seen: 2, mastered: 1, learning: 1, untouched: 8, accuracy: 0.8 });
eq('stats(null, totals)', store.stats(null, { cet4: 10, cet6: 5 }), { total: 15, seen: 3, mastered: 1, learning: 2, untouched: 12, accuracy: 0.833 });
eq('stats() 无 total → total 0', store.stats(null, undefined).total, 0);
eq('stats 未知 level → 全 0', store.stats('cet9', 7), { total: 7, seen: 0, mastered: 0, learning: 0, untouched: 7, accuracy: 0 });

/* ---------- 7. export / import ---------- */
store.updateSettings({ level: 'cet6', dailyGoal: 25 });
const snapshotData = store.exportAll();
const beforeStats = store.stats(null, { cet4: 100, cet6: 50 });
const beforeWrong = store.wrong();
check('exportAll 结构完整', !!(snapshotData.v === 1 && snapshotData.settings && snapshotData.recs && snapshotData.daily && Array.isArray(snapshotData.wrong)));
store.reset();
eq('reset 后清空进度', store.stats(null, { cet4: 100, cet6: 50 }).seen, 0);
store.importAll(snapshotData);
eq('importAll 往返 stats 一致', store.stats(null, { cet4: 100, cet6: 50 }), beforeStats);
eq('importAll 往返 settings 一致', store.settings().level, 'cet6');
eq('importAll 往返 wrong 一致', store.wrong(), beforeWrong);
eq('importAll 往返 daily 一致', store.daily().goal, snapshotData.daily.goal);

/* ---------- 8. importAll 校验 ---------- */
throws('importAll(null) 抛错', function () { store.importAll(null); });
throws('importAll([]) 抛错', function () { store.importAll([]); });
throws('importAll("x") 抛错', function () { store.importAll('x'); });
throws('importAll({settings:1}) 抛错', function () { store.importAll({ settings: 1 }); });
throws('importAll({recs:"x"}) 抛错', function () { store.importAll({ recs: 'x' }); });
throws('importAll({recs:{k:1}}) 抛错', function () { store.importAll({ recs: { k: 1 } }); });
throws('importAll({wrong:{}}) 抛错', function () { store.importAll({ wrong: {} }); });
throws('importAll({wrong:[{key:""}]}) 抛错', function () { store.importAll({ wrong: [{ key: '' }] }); });

/* ---------- 9. subscribe ---------- */
store.reset();
let count = 0;
let lastSnap = null;
const unwatch = store.subscribe(function (snap) { count += 1; lastSnap = snap; });
store.markSeen('cet4:sub', true);
store.markSeen('cet4:sub', true);
store.setDailyGoal(21);
store.addWrong({ key: 'cet4:sub', word: 'sub', level: 'cet4' });
eq('subscribe 同步触发次数', count, 4);
check('subscribe 收到 snapshot', !!(lastSnap && lastSnap.settings && lastSnap.daily && Array.isArray(lastSnap.wrong)));
unwatch();
store.markSeen('cet4:sub', true);
eq('unwatch 后不再触发', count, 4);

/* ---------- 10. reset 只清 cev1: 前缀 ---------- */
store.reset();
localStorage.setItem('other:keep', '1');
localStorage.setItem('cev1:fake', '"x"');
store.markSeen('cet4:zzz', true);
store.reset();
eq('reset 清掉 cev1:recs', localStorage.getItem('cev1:recs'), null);
eq('reset 清掉 cev1:daily', localStorage.getItem('cev1:daily'), null);
eq('reset 清掉其它 cev1:*', localStorage.getItem('cev1:fake'), null);
eq('reset 保留非 cev1: 键', localStorage.getItem('other:keep'), '1');

/* ---------- 11. 脏数据容错 ---------- */
localStorage.setItem('cev1:recs', '{ not json');
localStorage.setItem('cev1:settings', '"str"');
localStorage.setItem('cev1:daily', 'null');
localStorage.setItem('cev1:wrong', '{"a":1}');
let dirtyOk = true;
let dirtyErr = '';
try {
  eq('脏 settings 回退默认', store.settings(), { level: 'cet4', dailyGoal: 20, quizSize: 10 });
  eq('脏 recs 回退默认 rec', store.rec('cet4:any'), { seen: 0, right: 0, wrong: 0, box: 0, last: 0, due: 0 });
  eq('脏 daily 回退', [store.daily().doneCount, store.daily().goal], [0, 20]);
  eq('脏 wrong 回退空数组', store.wrong(), []);
  store.markSeen('cet4:any', true);
  eq('脏数据后仍可写入', store.rec('cet4:any').box, 1);
} catch (e) {
  dirtyOk = false;
  dirtyErr = String(e && e.message);
}
check('脏数据不抛异常并自动回退', dirtyOk, dirtyErr);
store.reset();

/* ---------- 汇总 ---------- */
setNow(null);
console.log('--- 结果：PASS ' + pass + ' / FAIL ' + fail + ' ---');
if (fail > 0) {
  console.log('失败项：' + failures.join(' | '));
  process.exit(1);
}
process.exit(0);
