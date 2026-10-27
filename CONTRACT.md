# CONTRACT.md — CET 词汇复习站 模块契约 v1

> 所有并行开发的 Agent 以此文件为准。**不得修改本文件**；接口有疑问向 Lead 报告，不要自行改契约。

## 1. 目录与文件归属（严格不越界）

```
cet-vocab/
  index.html                      [S2]
  CONTRACT.md                     [Lead]
  assets/css/base.css             [S2]   设计令牌/重置/布局/导航/工具类
  assets/css/components.css       [S2]   通用组件
  assets/css/features/browse.css  [S3]
  assets/css/features/cards.css   [S3]
  assets/css/features/plan.css    [S4]
  assets/css/features/progress.css[S4]
  assets/css/features/quiz.css    [S5]
  assets/css/features/wrong.css   [S5]
  assets/js/app.js                [S2]   启动/注册路由
  assets/js/core/store.js         [S2]
  assets/js/core/bank.js          [S2]
  assets/js/core/router.js        [S2]
  assets/js/core/util.js          [S2]
  assets/js/features/browse.js    [S3]
  assets/js/features/cards.js     [S3]
  assets/js/features/plan.js      [S4]
  assets/js/features/progress.js  [S4]
  assets/js/features/quiz.js      [S5]
  assets/js/features/wrong.js     [S5]
  data/manifest.json              [S1]
  data/cet4.json                  [S1]
  data/cet6.json                  [S1]
  scripts/*                       [S1 数据脚本]
  README.md .gitignore .nojekyll .github/workflows/pages.yml   [Lead]
```

纯静态站点，**无构建步骤**、无第三方依赖、无 CDN。所有 JS 是原生 ES module（`type="module"`）。
浏览器强约束：Chrome/Safari/Firefox/Edge 近两年版本 + iOS Safari。禁止未加前缀的新语法（可选链可用）。

## 2. 数据格式（S1 产出，S2/S3/S4/S5 消费）

`data/cet4.json` / `data/cet6.json`：

```json
{
  "level": "cet4",
  "label": "四级",
  "updatedAt": "2025-01-01",
  "words": [
    {
      "word": "cancel",
      "ipa": "ˈkænsl",
      "ipaUs": "ˈkænsl",
      "meanings": ["取消，撤销", "删去"],
      "pos": "vt.",
      "example": { "en": "The concert was cancelled because of the rain.", "src": "tatoeba" }
    }
  ]
}
```

- `word`：小写、去首尾空白、唯一；这是唯一身份键。
- `ipa`：可为空字符串 `""`；`ipaUs` 可缺省。音标放在中括号里展示由前端负责。
- `meanings`：至少 1 条，最多 3 条；纯文本，不含 HTML。
- `pos`：词性（`n.` `vt.` `adj.` …）或 `null`。
- `example`：`{en, src}` 或 `null`。`zh` 字段可选缺省（本期例句以英文为主）。

`data/manifest.json`：

```json
{
  "generatedAt": "2025-01-01T00:00:00.000Z",
  "levels": {
    "cet4": { "label": "四级", "file": "cet4.json", "count": 5871, "withIpa": 5800, "withExample": 4100 },
    "cet6": { "label": "六级", "file": "cet6.json", "count": 3318, "withIpa": 3300, "withExample": 2200 }
  },
  "sources": [{ "name": "qwerty-learner CET4_T", "url": "...", "license": "MIT" }]
}
```

## 3. 词身份键

`key = level + ":" + word`，例如 `cet4:cancel`。词库浏览、翻卡、测试、错词、进度**全部**用它作为唯一键。

## 4. core/util.js

```js
export function el(tag, attrs, children);   // attrs: {class,text,html,onClick,...data-*}; children: Node|string|array
export function q(sel, root = document);
export function qa(sel, root = document);
export function shuffle(arr);              // 返回新数组
export function sample(arr, n);            // 返回 n 个不重复元素数组
export function todayKey(date = new Date()); // "YYYY-MM-DD"（本地时区）
export function esc(str);                  // HTML 转义
export function fmtPct(x);                 // 0.832 -> "83%"
export function debounce(fn, ms);
export function toast(msg, kind = "info"); // kind: info|ok|err，屏幕下方浮出 2.4s
export function emptyState(title, desc);   // 返回 .empty 元素
```

## 5. core/store.js（唯一状态源，localStorage 前缀 `cev1:`）

```js
export const store = {
  settings(),                                   // {level:'cet4'|'cet6', dailyGoal:number, quizSize:number}
  updateSettings(patch),                        // 合并写入，触发 subscribe
  rec(key),                                     // {seen,right,wrong,box(0..5),last,due} 默认 {seen:0,right:0,wrong:0,box:0,last:0,due:0}
  markSeen(key, correct),                       // 更新 box/right/wrong/last/due，并计入当日计划；触发 subscribe；返回 rec
  progressOf(key),                              // {box, mastery:0..100, state:'new'|'learning'|'mastered'}
  daily(),                                      // {date:'YYYY-MM-DD', goal, doneKeys:[key], doneCount}
  setDailyGoal(n),
  markPlannedDone(key),                         // 幂等把 key 记入今日完成
  wrong(),                                      // [{key, word, level, count, firstAt, lastAt}] 按 lastAt 倒序
  addWrong({key, word, level}),                 // 已存在则 count++ 并刷新 lastAt，触发 subscribe
  removeWrong(key),
  clearWrong(),
  stats(level),                                 // level 省略=全部；{total,seen,mastered,learning,untouched,accuracy}
  exportAll(),                                  // 返回可 JSON.stringify 的对象
  importAll(obj),                               // 校验失败抛 Error
  reset(),                                      // 清空 cev1:* 命名空间
  subscribe(fn),                                // fn(snapshot) 任何写入后同步调用；返回 unwatch
};
```

掌握度规则（全局统一，不得各模块自创）：
- `box` 0→5。答对 `box+1`（上限 5）；答错 `box = max(0, box-1)`。
- `mastery = Math.round(box / 5 * 100)`。
- `state`：`seen===0 → 'new'`；`box>=4 → 'mastered'`；其余 `'learning'`。
- `due`：box 0→now，1→+1天，2→+2天，3→+4天，4→+7天，5→+15天。
- 当日计划：`markSeen` 或 `markPlannedDone` 都把 key 计入 `daily().doneKeys`（同一天去重）。
- 日期跨天：`daily()` 读到的日期不是今天则视为新的一天（doneKeys 归零，goal 保留）。

`stats(level)` 需要知道每个 level 的词总数 → 由调用方先 `await bank.load(...)`，并把总数传给 `store.stats` 的第二参数：`store.stats(level, total)` / `store.stats(null, totals)`（`totals` 为 `{cet4:5871,cet6:3318}`）。实现时两者都要能接受。

## 6. core/bank.js

```js
export const bank = {
  manifest(),                          // Promise<manifest>；失败抛 Error("词库清单加载失败")
  load(level),                         // Promise<{level,label,words}>；同一 level 只 fetch 一次；失败抛 Error
  loaded(level),                       // 同步：已加载的 words 数组或 null
  word(level, key),                    // 已加载词的 Word 对象或 null（key 可带或不带 "cet4:" 前缀）
  items(levels),                       // Promise<[{level, word, ipa, ipaUs, meanings, pos, example, key}]>，levels 形如 ['cet4','cet6']
  random({levels, count, exclude}),    // Promise<[item]>；exclude 是 Set<key>；不足时返回可用的全部
  count(level),                        // Promise<number>，来自 manifest（未加载也能用）
};
```

## 7. core/router.js

```js
export const router = {
  register(name, {title, mount}),  // mount(rootEl) 可返回 cleanup 函数
  start(defaultName = "plan"),     // 解析 location.hash，监听 hashchange
  go(name),                        // 修改 hash
  current(),
};
```
路由名与 hash：`browse #/browse`、`cards #/cards`、`plan #/plan`、`quiz #/quiz`、`wrong #/wrong`、`progress #/progress`。
切换路由前必须调用上一个视图的 cleanup，并把内容渲染进 `#view`。

## 8. feature 模块导出契约

每个 `assets/js/features/<name>.js`：

```js
export const route = {
  name: "cards",
  title: "翻卡记忆",
  mount(rootEl) {
    // 渲染到 rootEl 内；返回 cleanup（可选）
    return () => { /* 解绑定时器/监听 */ };
  },
};
```

**禁止**直接改 `document.body`、改其他模块的 CSS 文件、或在模块顶层执行副作用（顶层只允许 import 与 const 定义）。

## 9. index.html（S2 实现）结构契约

```html
<body>
  <header class="app-header">
    <div class="app-brand">…</div>
    <nav class="app-nav" id="app-nav">…</nav>            <!-- app.js 填充链接 -->
    <div class="app-hud" id="app-hud">…</div>             <!-- 今日 n/goal、总体掌握度 -->
  </header>
  <main class="view" id="view"><!-- router 渲染 --></main>
  <div class="toast-host" id="toast-host"></div>
  <script type="module" src="./assets/js/app.js"></script>
</body>
```

`index.html` 内置以下 `<link rel="stylesheet">`（顺序不可变），后 6 个由对应 owner 填充，S2 只建空文件：
`base.css, components.css, features/browse.css, features/cards.css, features/plan.css, features/progress.css, features/quiz.css, features/wrong.css`

app.js 必须用**动态 import** 装载 feature 模块，模块缺失/抛错时在 `#view` 渲染 `.empty` 占位而不是白屏。

## 10. CSS 设计令牌与通用类（S2 定义，其他模块只准用不重定义）

令牌（`:root`）：`--bg --surface --surface-2 --text --muted --line --brand --brand-weak --ok --err --warn --radius --radius-sm --shadow --pad --pad-lg --font --font-display`
尺寸：移动端优先，`--pad:14px`；`@media (min-width:768px)` 提升到 `--pad-lg`，容器最大宽 1080px 居中。

通用类：`.btn .btn--primary .btn--ghost .btn--danger .btn--sm`、`.chip .chip--cet4 .chip--cet6`、`.panel`、`.stat-grid .stat .stat__num .stat__label`、`.progress .progress__bar`、`.input .select`、`.grid`、`.empty .empty__title .empty__desc`、`.toast .toast--ok .toast--err`、`.stack .row .spacer`、`.sr-only`。
响应式断点：`640px`（小屏 → 中屏）、`900px`（→ 桌面）。所有功能在 320px 宽度下不得横向滚动。

## 11. 无障碍与体验底线

- 按钮用 `<button type="button">`；表单控件带 `<label>` 或 `aria-label`。
- 键盘可用：卡片翻面支持 Enter/Space；测试选项支持 1-4 数字键与方向键。
- 所有交互有 `:focus-visible` 可见焦点环。
- 尊重 `prefers-reduced-motion: reduce`（关闭翻转/位移动画）。
