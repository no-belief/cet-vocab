# 四六级词汇复习 · CET Vocabulary

一个**纯静态、免构建、离线可用**的大学英语四/六级单词复习站：词库分类浏览、翻卡记忆、每日学习计划、随机测试、错词回顾、掌握度进度，桌面端与移动端自适应。数据全部存在浏览器本地（localStorage），无需登录、无后端、无第三方依赖。

## 一、功能对照

| # | 需求 | 实现 | 路由 |
|---|---|---|---|
| 1 | 词库按四级/六级分类，每词含音标、释义、例句 | 级别切换 + 搜索 + 掌握度筛选；首屏 60 条增量渲染（四级 5871 词） | `#/browse` |
| 2 | 翻卡记忆（正反面为音标/释义/例句组合） | 3D 翻转卡：正面 word+音标，背面释义+例句；键盘空格/Enter 翻面、J/K 评级 | `#/cards` |
| 3 | 每日学习计划：设定每日学习量并展示当天任务与完成情况 | 1–200 词可调 + 快捷 10/20/30/50；今日完成 n/goal 进度条、已学清单、达标庆祝 | `#/plan` |
| 4 | 随机测试 | 题量 10/20/30、范围四级/六级/两者、题型英→中·中→英·混合；4 选项即时判定 | `#/quiz` |
| 5 | 错词回顾 | 答错自动入错词本；列表 + 集中复习翻卡（记住了移出，不熟保留） | `#/wrong` |
| 6 | 学习进度与掌握程度 | 总览 5 项统计、每级掌握度堆叠条、单词级 box 0–5 与百分比、搜索排序、重置 | `#/progress` |
| 7 | 页面体验 | 移动优先响应式（320px 无横向滚动）、键盘可达、`:focus-visible` 焦点环、`prefers-reduced-motion` 降级 | 全站 |

## 二、本地运行（必须走 http，不能双击 file:// 打开）

```bash
cd cet-vocab
python -m http.server 8000
# 浏览器打开 http://127.0.0.1:8000/
```

也可以用 `npx serve .`（Node 环境）。**直接双击 index.html 会因浏览器 `file://` 的 CORS 限制而无法 fetch 词库**，页面会给出对应提示。

## 三、部署到 GitHub Pages

仓库已内置 `.github/workflows/pages.yml`（push 到 `main` 自动部署，只把 `index.html`、`assets/`、`data/` 打进产物）。

**首次推送**（把 `<你的账号>/<仓库名>` 换成实际值）：
```bash
git remote add origin https://github.com/<你的账号>/<仓库名>.git
git branch -M main
git push -u origin main
```

**然后开启 Pages**：仓库 → Settings → Pages → Build and deployment → Source 选 **GitHub Actions**（不要选 "Deploy from a branch"）。等 Actions 变绿，站点地址为
`https://<你的账号>.github.io/<仓库名>/`

> 站点全部用相对路径引用资源，因此部署在仓库子路径下无需任何改动。

## 四、数据来源与许可

| 用途 | 来源 | 许可 |
|---|---|---|
| 词条（单词、音标、中文释义） | [qwerty-learner](https://github.com/Kaiyiwing/qwerty-learner) 的 CET4_T / DanCiDeJianFa_4 / Level4luan_2_T（四级），CET6_T / DanCiDeJianFa_6（六级） | MIT |
| 例句（真实英文句子） | [Tatoeba](https://tatoeba.org) `eng_sentences` 语料 | CC-BY 2.0 FR（署名：例句来自 Tatoeba 贡献者） |

重新生成数据（需要网络，约 3–5 分钟）：
```bash
node scripts/fetch-data.mjs     # 下载并缓存到 .cache/（1MB 分块 + 续传）
python scripts/build-data.py    # 生成 data/cet4.json、cet6.json、manifest.json
```
`.cache/` 已加入 `.gitignore`，不入库。

## 五、当前词库规模与已知限制（如实说明）

- **四级 5871 词**（三本四级词书去重并集），**六级 3318 词**（两本六级词书去重并集）。
  六级不足 4000 不是遗漏：现有真实六级词书去重后就是这个量级（官方六级大纲新增词也约 3000），强行凑到 4000+ 只能混入考研/专八词并**错标级别**，因此选择标注真实。
- 音标覆盖：四级 5837（99.4%）、六级 3318（100%）；**例句覆盖：四级 5810（99.0%）、六级 3298（99.4%）**，其余显示「暂无例句」。
- 例句为**英文原句**，未附中文翻译（源语料无对齐译文；界面与数据结构已支持 `example.zh`，后续补数据即可显示）。
- 词性 chip 覆盖：四级 28.5%、六级 99.0%。四级三本源书中只有一本带词性信息，这是源数据上限（1675/1679 已收录），未编造词性。
- 例句选择策略偏向短句（按 token 数最少优先），因此部分例句偏简单（如 "Tom ate a turnip."）。
- 翻卡牌堆单次上限 60 张（可在 `cards.js` 的 `DECK_LIMIT` 调整，传 0 不限）。
- 进度页单词级列表最多渲染 300 行（超出提示用搜索/排序缩小范围），避免一次渲染上万节点。

## 六、学习机制（全站统一口径）

- 每个词的掌握度用 **box 0–5** 表示：答对 `box+1`（上限 5），答错 `box-1`（下限 0）。
- `掌握度% = box / 5 × 100`；`box ≥ 4` 记为「已掌握」，`seen = 0` 为「未学」，其余「学习中」。
- 复习间隔：box 0/1/2/3/4/5 → 立即 / 1 / 2 / 4 / 7 / 15 天。
- **每日计划**：翻卡评级与任意测试答题都会计入当日已完成词数（同一天同一词只计一次），跨天自动归零（保留目标值）。
- **错词本**：测试答错自动入册并累计错次；**答对一次即移出**（错词集中复习里点「记住了」同理）。
- 所有数据存于 localStorage，键前缀 `cev1:`；`#/progress` 底部可一键重置。

## 七、自测与验收

页面之外附带四套 Node 自测脚本（无需安装任何依赖）：

```bash
node scripts/selftest-core.mjs            # 状态层：box/掌握度/每日/错词/导入导出/脏数据容错  PASS 77
node scripts/selftest-browse-cards.mjs    # 浏览+翻卡（含真实词库 mount）               PASS 133
node scripts/selftest-plan-progress.mjs   # 计划+进度（含 343 组堆叠条穷举）            PASS 165
node scripts/selftest-quiz-wrong.mjs      # 测试+错词（含干扰项去重、store 端到端）      PASS 110
```

合计 485 条断言。另有一层独立的跨模块集成探针（模块导出形状、6 条路由注册、16 个资源 200、manifest 计数、响应式断点与减动效）：37 项通过。

## 八、浏览器兼容

Chrome / Edge / Firefox / Safari 近两年版本，iOS Safari 15+。使用原生 ES module、CSS 变量与 `backdrop-filter` 可选降级，无 polyfill 依赖。
