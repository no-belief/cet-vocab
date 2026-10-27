/* features/quiz.js — 随机测试（owner: S5）
 * 纯逻辑均具名导出，便于 node 自测；顶层只有 import 与 const，不碰 document/localStorage。
 */
import { store } from '../core/store.js';
import { bank } from '../core/bank.js';
import { router } from '../core/router.js';
import { el, fmtPct, toast, createAudioButton } from '../core/util.js';

const SIZES = [10, 20, 30];
const RANGES = [
  { id: 'cet4', label: '四级' },
  { id: 'cet6', label: '六级' },
  { id: 'both', label: '两者' },
];
const MODES = [
  { id: 'en2zh', label: '英→中选义' },
  { id: 'zh2en', label: '中→英选词' },
  { id: 'mixed', label: '混合' },
];
const OPTION_COUNT = 4;
const AUTO_MS = 900;
const SIG_STRIP = /[\s，,、;；/。.：:()（）"'“”‘’]/g;

const prefs = { auto: true };

/* ================= 纯逻辑 ================= */

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/** 音标展示：[ˈkænsl]；空音标返回 '' */
export function ipaText(item) {
  const ipa = trimStr(item && item.ipa);
  return ipa ? '[' + ipa + ']' : '';
}

/** 去空、去重后的释义数组 */
export function meaningsList(item) {
  const arr = item && Array.isArray(item.meanings) ? item.meanings : [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const m = trimStr(arr[i]);
    if (m && out.indexOf(m) < 0) out.push(m);
  }
  return out;
}

/** 释义展示文本（多义用「；」分隔） */
export function meaningsText(item) {
  return meaningsList(item).join('；');
}

/** 例句英文文本；example 为 null / 缺 en 时返回 ''（UI 必须优雅降级） */
export function exampleText(item) {
  const ex = item && item.example;
  if (!ex || typeof ex !== 'object') return '';
  return trimStr(ex.en);
}

/** 释义归一化签名：用于「干扰项释义必须与正确答案不同」的判重 */
export function meaningSig(item) {
  const list = meaningsList(item);
  const sigs = [];
  for (let i = 0; i < list.length; i++) sigs.push(list[i].toLowerCase().replace(SIG_STRIP, ''));
  return sigs.join('|');
}

/** 选项文本：en2zh 用「词性 + 释义」，zh2en 用英文单词 */
export function optionText(item, mode) {
  if (!item) return '';
  if (mode === 'zh2en') return trimStr(item.word);
  const mean = meaningsText(item);
  const pos = trimStr(item.pos);
  if (!mean) return pos;
  return pos ? pos + ' ' + mean : mean;
}

function keyOf(item) {
  const k = trimStr(item && item.key);
  if (k) return k;
  const w = trimStr(item && item.word).toLowerCase();
  const lv = trimStr(item && item.level);
  return lv ? lv + ':' + w : w;
}

function clampRand(rand) {
  const v = Number(rand());
  if (!isFinite(v) || v <= 0) return 0;
  if (v >= 1) return 0.9999999999;
  return v;
}

/** 用注入的 rng 做部分 Fisher-Yates，取 n 个互不重复的元素 */
function takeRandom(list, n, rand) {
  const copy = Array.isArray(list) ? list.slice() : [];
  const want = Math.max(0, Math.min(Math.floor(Number(n) || 0), copy.length));
  const out = [];
  for (let i = 0; i < want; i++) {
    const j = i + Math.floor(clampRand(rand) * (copy.length - i));
    const t = copy[i];
    copy[i] = copy[j];
    copy[j] = t;
    out.push(copy[i]);
  }
  return out;
}

/**
 * buildOptions(word, pool, rng, mode='en2zh')
 * → { options: [{text, key, correct}], correctIndex, mode }
 * options 恰好 4 项（可用干扰项不足时优雅降级为 1 + 可用数）；
 * 干扰项的释义签名与选项文本都不得与正确答案重复，彼此之间也不重复。
 */
export function buildOptions(word, pool, rng, mode) {
  const rand = typeof rng === 'function' ? rng : Math.random;
  const md = mode === 'zh2en' ? 'zh2en' : 'en2zh';
  const target = word && typeof word === 'object' ? word : null;
  if (!target) return { options: [], correctIndex: -1, mode: md };

  const correctText = optionText(target, md);
  const correctSig = meaningSig(target);
  const correctWord = trimStr(target.word).toLowerCase();
  const correctKey = keyOf(target);

  const seen = {};
  const cands = [];
  const src = Array.isArray(pool) ? pool : [];
  for (let i = 0; i < src.length; i++) {
    const it = src[i];
    if (!it || typeof it !== 'object') continue;
    const k = keyOf(it);
    if (k === correctKey || seen[k]) continue;
    // 同一个词（跨级别重名）不能当干扰项：中文选义时选项文本会与正确答案完全重合
    if (trimStr(it.word).toLowerCase() === correctWord) continue;
    const sig = meaningSig(it);
    if (!sig || sig === correctSig) continue;
    const text = optionText(it, md);
    if (!text) continue;
    const sigKey = 's:' + sig;
    const textKey = 't:' + text.toLowerCase();
    if (seen[sigKey] || seen[textKey]) continue;
    seen[k] = 1;
    seen[sigKey] = 1;
    seen[textKey] = 1;
    cands.push({ key: k, text: text });
  }

  const picked = takeRandom(cands, OPTION_COUNT - 1, rand);
  const options = [];
  for (let i = 0; i < picked.length; i++) {
    options.push({ text: picked[i].text, key: picked[i].key, correct: false });
  }
  const at = Math.min(options.length, Math.floor(clampRand(rand) * (options.length + 1)));
  options.splice(at, 0, { text: correctText, key: correctKey, correct: true });
  return { options: options, correctIndex: at, mode: md };
}

/** 混合题型按下标交替 en2zh / zh2en；固定题型原样返回 */
export function modeForIndex(index, mode) {
  if (mode === 'zh2en') return 'zh2en';
  if (mode === 'en2zh') return 'en2zh';
  const i = Math.max(0, Math.floor(Number(index) || 0));
  return i % 2 === 0 ? 'en2zh' : 'zh2en';
}

/** 组一道题：{item, mode, prompt, hint, options, correctIndex} */
export function buildQuestion(item, pool, mode, rng) {
  const md = mode === 'zh2en' ? 'zh2en' : 'en2zh';
  const built = buildOptions(item, pool, rng, md);
  return {
    item: item,
    mode: md,
    prompt: md === 'zh2en' ? meaningsText(item) : trimStr(item && item.word),
    hint: md === 'zh2en' ? trimStr(item && item.pos) : ipaText(item),
    options: built.options,
    correctIndex: built.correctIndex,
  };
}

/** 判定：选中下标是否就是正确项；越界/非法一律判错 */
export function gradeQuestion(question, chosenIndex) {
  if (!question) return false;
  const opts = Array.isArray(question.options) ? question.options : [];
  const i = Number(chosenIndex);
  if (!isFinite(i)) return false;
  const idx = Math.floor(i);
  if (idx < 0 || idx >= opts.length) return false;
  const opt = opts[idx];
  if (opt && typeof opt.correct === 'boolean') return opt.correct;
  return idx === Number(question.correctIndex);
}

/** answers: boolean[] → {total, right, wrong, accuracy(0..1)} */
export function scoreOf(answers) {
  const list = Array.isArray(answers) ? answers : [];
  let right = 0;
  for (let i = 0; i < list.length; i++) if (list[i] === true) right += 1;
  const total = list.length;
  return { total: total, right: right, wrong: total - right, accuracy: total ? right / total : 0 };
}

/** 秒 → mm:ss（负数/非数字按 0；分钟不折成小时，超过 59 继续累加） */
export function mmss(sec) {
  const n = Number(sec);
  const total = !isFinite(n) || n <= 0 ? 0 : Math.floor(n);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

/** 时间戳 → 相对时间；未来时间与 60s 内都显示「刚刚」，超过 30 天显示「超过 30 天」 */
export function relTime(ts, nowMs) {
  const t = Number(ts);
  const base = Number(nowMs);
  const now = isFinite(base) ? base : Date.now();
  if (!isFinite(t) || t <= 0) return '未知时间';
  const diff = now - t;
  if (diff < 0) return '刚刚';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + ' 分钟前';
  const hour = Math.floor(min / 60);
  if (hour < 24) return hour + ' 小时前';
  const day = Math.floor(hour / 24);
  if (day < 30) return day + ' 天前';
  return '超过 30 天';
}

/** 从池子里抽 count 个不重复的词（按 key 去重，超过池容量时返回全部） */
export function pickQuizWords(pool, count, rng) {
  const rand = typeof rng === 'function' ? rng : Math.random;
  const src = Array.isArray(pool) ? pool : [];
  const uniq = [];
  const seen = {};
  for (let i = 0; i < src.length; i++) {
    const it = src[i];
    if (!it || typeof it !== 'object') continue;
    const k = keyOf(it);
    if (!k || seen[k]) continue;
    seen[k] = 1;
    uniq.push(it);
  }
  return takeRandom(uniq, Math.max(0, Math.floor(Number(count) || 0)), rand);
}

/** 结束页评价文案 */
export function evalText(accuracy, total) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  const acc = Number(accuracy);
  if (!n) return '这一组没有作答，随时可以再来一组。';
  if (!isFinite(acc)) return '这一组完成了，再来一组保持手感。';
  if (acc >= 0.9) return '稳！几乎全对，这个节奏保持住。';
  if (acc >= 0.75) return '不错，主要障碍已经扫清，再练一组就更稳。';
  if (acc >= 0.6) return '在及格线之上，错词已经进了错词本，回顾一遍再测。';
  if (acc >= 0.4) return '有印象但还不牢，建议先去错词本集中过一遍。';
  return '别急，先把错词本刷一遍，再来一组会轻松很多。';
}

/* ================= DOM 装配 ================= */

function statEl(num, label) {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'stat__num', text: String(num) }),
    el('span', { class: 'stat__label', text: String(label) }),
  ]);
}

function segField(label, opts, value, onPick, after, rootEl) {
  const btns = [];
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    btns.push(
      el('button', {
        type: 'button',
        class: 'seg__btn' + (o.id === value ? ' is-on' : ''),
        'aria-pressed': o.id === value ? 'true' : 'false',
        text: o.label,
        onClick: function () {
          onPick(o.id);
          after();
          // 重渲染后把焦点还给刚点的那个按钮，键盘操作不丢焦点
          try {
            if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
            const all = rootEl.querySelectorAll('.seg__btn');
            for (let k = 0; k < all.length; k++) {
              if (all[k].textContent === o.label && typeof all[k].focus === 'function') {
                all[k].focus();
                break;
              }
            }
          } catch (e) { /* 忽略 */ }
        },
      })
    );
  }
  return el('div', { class: 'quiz-field' }, [
    el('span', { class: 'quiz-field__label', text: label }),
    el('div', { class: 'seg', role: 'group', 'aria-label': label }, btns),
  ]);
}

function wordEcho(item) {
  const it = item || {};
  const wordText = trimStr(it.word);
  const head = [
    el('span', { class: 'quiz-echo__word', text: wordText }),
    wordText ? createAudioButton(wordText) : null,
  ];
  const ipa = ipaText(it);
  if (ipa) head.push(el('span', { class: 'quiz-echo__ipa', text: ipa }));
  const kids = [el('div', { class: 'quiz-echo__head' }, head)];
  const mean = meaningsText(it);
  const pos = trimStr(it.pos);
  if (mean || pos) kids.push(el('p', { class: 'quiz-echo__mean', text: (pos ? pos + ' ' : '') + mean }));
  const ex = exampleText(it);
  if (ex) kids.push(el('p', { class: 'quiz-echo__ex', text: ex }));
  return el('div', { class: 'quiz-echo' }, kids);
}

function mount(root) {
  const settings = (function () {
    try { return store.settings(); } catch (e) { return { level: 'cet4', dailyGoal: 20, quizSize: 10 }; }
  })();

  const s = {
    phase: 'start', // start | running | done
    size: SIZES.indexOf(settings.quizSize) >= 0 ? settings.quizSize : 10,
    range: settings.level === 'cet6' ? 'cet6' : 'cet4',
    mode: 'en2zh',
    loading: false,
    questions: [],
    index: 0,
    answers: [],
    answered: false,
    chosen: -1,
    startedAt: 0,
    elapsedSec: 0,
    auto: prefs.auto,
    lastKeys: new Set(),
  };

  let disposed = false;
  let autoTimer = null;

  function clearAuto() {
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
  }

  function safeDaily() {
    try { return store.daily(); } catch (e) { return { doneCount: 0, goal: 0 }; }
  }

  function safeWrongCount() {
    try { return store.wrong().length; } catch (e) { return 0; }
  }

  function paint() {
    if (disposed || !root) return;
    root.innerHTML = '';
    const node = s.phase === 'running' ? viewQuiz() : s.phase === 'done' ? viewDone() : viewStart();
    root.appendChild(node);
  }

  /* ---------- 开始页 ---------- */
  function viewStart() {
    const daily = safeDaily();
    const wrap = el('div', { class: 'quiz' });

    wrap.appendChild(
      el('section', { class: 'panel quiz-intro' }, [
        el('h2', { class: 'quiz-intro__title', text: '随机测试' }),
        el('p', {
          class: 'quiz-intro__desc',
          text: '从词库里随机抽词，每题四个选项。答错的词自动进入错词本；答对过一次就会从错词本里移出去。',
        }),
      ])
    );

    const autoBox = el('input', {
      type: 'checkbox',
      id: 'quiz-auto',
      checked: s.auto,
      on: {
        change: function (ev) {
          s.auto = !!ev.target.checked;
          prefs.auto = s.auto;
        },
      },
    });

    const form = el('section', { class: 'panel quiz-form' }, [
      segField('题量', SIZES.map(function (n) { return { id: String(n), label: n + ' 题' }; }), String(s.size), function (v) { s.size = Number(v); }, paint, root),
      segField('范围', RANGES, s.range, function (v) { s.range = v; }, paint, root),
      segField('题型', MODES, s.mode, function (v) { s.mode = v; }, paint, root),
      el('label', { class: 'quiz-auto', for: 'quiz-auto' }, [autoBox, '答对后 0.9 秒自动进入下一题']),
    ]);
    wrap.appendChild(form);

    wrap.appendChild(
      el('button', {
        type: 'button',
        class: 'btn btn--primary quiz-start',
        disabled: s.loading,
        text: s.loading ? '正在抽词…' : '开始测试',
        onClick: begin,
      })
    );

    wrap.appendChild(
      el('p', {
        class: 'quiz-hint',
        text: '今日已完成 ' + String(daily.doneCount) + ' / ' + String(daily.goal) + ' 个词，错词本里现在有 ' + String(safeWrongCount()) + ' 个词。',
      })
    );
    return wrap;
  }

  /* ---------- 答题页 ---------- */
  function viewQuiz() {
    const q = s.questions[s.index];
    if (!q) return viewStart();
    const total = s.questions.length;
    const right = scoreOf(s.answers).right;
    const progress = total ? Math.round((s.answers.length / total) * 100) : 0;

    const wrap = el('div', { class: 'quiz' });

    wrap.appendChild(
      el('div', { class: 'quiz-head' }, [
        el('div', { class: 'quiz-head__meta' }, [
          el('span', { class: 'quiz-head__idx', text: '第 ' + String(s.index + 1) + ' / ' + String(total) + ' 题' }),
          el('span', { text: '答对 ' + String(right) + ' 题' }),
        ]),
        el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(progress) }, [
          el('span', { class: 'progress__bar', style: { width: progress + '%' } }),
        ]),
      ])
    );

    const quizCardKids = [
        el('span', { class: 'quiz-card__mode', text: q.mode === 'zh2en' ? '中→英 选词' : '英→中 选义' }),
        el('p', { class: 'quiz-card__prompt', text: q.prompt || '—' }),
      ];
      // Add audio button for the word (en2zh shows word in prompt, zh2en shows meaning but we can still play the word)
      const quizWord = trimStr(q.item && q.item.word);
      if (quizWord) {
        quizCardKids.push(el('div', { class: 'quiz-card__audio' }, [createAudioButton(quizWord)]));
      }
      if (q.hint) quizCardKids.push(el('p', { class: 'quiz-card__hint', text: q.hint }));
      wrap.appendChild(
        el('section', { class: 'panel quiz-card' }, quizCardKids)
      );

    const optButtons = [];
    for (let i = 0; i < q.options.length; i++) {
      const o = q.options[i];
      let cls = 'quiz-opt';
      if (s.answered) {
        if (i === q.correctIndex) cls += ' is-correct';
        else if (i === s.chosen) cls += ' is-wrong';
        else cls += ' is-dim';
      }
      optButtons.push(
        el('button', {
          type: 'button',
          class: cls,
          'aria-disabled': s.answered ? 'true' : 'false',
          dataset: { idx: String(i) },
          onClick: (function (idx) {
            return function () { choose(idx); };
          })(i),
        }, [
          el('span', { class: 'quiz-opt__key', 'aria-hidden': 'true', text: String(i + 1) }),
          el('span', { class: 'quiz-opt__text', text: o.text }),
        ])
      );
    }
    wrap.appendChild(el('div', { class: 'quiz-options' }, optButtons));

    if (s.answered) {
      const ok = gradeQuestion(q, s.chosen);
      const answerText = q.options[q.correctIndex] ? q.options[q.correctIndex].text : '—';
      wrap.appendChild(
        el('p', { class: 'quiz-verdict ' + (ok ? 'is-ok' : 'is-err'), role: 'status' }, ok ? '回答正确' : '回答错误，正确答案是：' + answerText)
      );
      wrap.appendChild(wordEcho(q.item));
    }

    const actions = [];
    if (s.answered) {
      actions.push(
        el('button', {
          type: 'button',
          class: 'btn btn--primary',
          text: s.index + 1 >= s.questions.length ? '看结果' : '下一题',
          onClick: next,
        })
      );
    }
    actions.push(
      el('button', {
        type: 'button',
        class: 'btn btn--ghost',
        text: '结束本组',
        onClick: abort,
      })
    );
    wrap.appendChild(el('div', { class: 'quiz-actions' }, actions));

    wrap.appendChild(
      el('p', {
        class: 'quiz-foot',
        text: s.answered
          ? '已答对 ' + String(right) + ' 题。键盘 Enter 进入下一题，Esc 结束本组。'
          : '键盘 1-4 选择答案，Esc 结束本组。',
      })
    );
    return wrap;
  }

  /* ---------- 结束页 ---------- */
  function viewDone() {
    const sc = scoreOf(s.answers);
    const wrap = el('div', { class: 'quiz' });
    wrap.appendChild(
      el('section', { class: 'panel quiz-done' }, [
        el('h2', { class: 'quiz-done__title', text: '本组完成' }),
        el('p', { class: 'quiz-done__text', text: evalText(sc.accuracy, sc.total) }),
        el('div', { class: 'stat-grid' }, [
          statEl(String(sc.right) + '/' + String(sc.total), '答对'),
          statEl(fmtPct(sc.accuracy), '正确率'),
          statEl(mmss(s.elapsedSec), '用时'),
        ]),
        el('p', {
          class: 'quiz-done__text',
          text: '错词本里现在有 ' + String(safeWrongCount()) + ' 个词，答错的词会自动进去；答对过一次就会移出。',
        }),
      ])
    );

    wrap.appendChild(
      el('div', { class: 'quiz-actions' }, [
        el('button', { type: 'button', class: 'btn btn--primary', text: '再来一组', onClick: begin }),
        el('button', { type: 'button', class: 'btn', text: '回顾错词', onClick: function () { router.go('wrong'); } }),
        el('button', { type: 'button', class: 'btn', text: '回今日计划', onClick: function () { router.go('plan'); } }),
      ])
    );
    return wrap;
  }

  /* ---------- 流程 ---------- */
  async function begin() {
    if (s.loading || disposed) return;
    s.phase = 'start';
    s.loading = true;
    paint();
    const levels = s.range === 'both' ? ['cet4', 'cet6'] : [s.range];
    try {
      // 先避开上一组抽过的词；池子不足时补一次不排除的抽样
      const picked = await bank.random({ levels: levels, count: s.size, exclude: s.lastKeys });
      if (picked.length < s.size) {
        const seen = {};
        for (let i = 0; i < picked.length; i++) seen[picked[i].key] = 1;
        let extra = [];
        try { extra = await bank.random({ levels: levels, count: s.size }); } catch (e) { extra = []; }
        for (let i = 0; i < extra.length && picked.length < s.size; i++) {
          if (seen[extra[i].key]) continue;
          seen[extra[i].key] = 1;
          picked.push(extra[i]);
        }
      }
      const pool = await bank.items(levels);
      if (disposed) return;
      if (!picked.length) {
        s.loading = false;
        paint();
        toast('没有抽到词，请确认词库能正常加载', 'err');
        return;
      }
      try { store.updateSettings({ quizSize: s.size }); } catch (e) { /* 忽略 */ }
      const questions = [];
      for (let i = 0; i < picked.length; i++) {
        questions.push(buildQuestion(picked[i], pool, modeForIndex(i, s.mode), Math.random));
      }
      s.questions = questions;
      s.lastKeys = new Set(picked.map(function (it) { return it.key; }));
      s.index = 0;
      s.answers = [];
      s.answered = false;
      s.chosen = -1;
      s.startedAt = Date.now();
      s.elapsedSec = 0;
      s.phase = 'running';
      s.loading = false;
      paint();
    } catch (err) {
      if (disposed) return;
      s.loading = false;
      paint();
      toast((err && err.message) || '抽题失败，请稍后再试', 'err');
    }
  }

  function choose(i) {
    if (s.phase !== 'running' || s.answered) return;
    const q = s.questions[s.index];
    if (!q) return;
    const idx = Math.floor(Number(i));
    if (!isFinite(idx) || idx < 0 || idx >= q.options.length) return;
    const ok = gradeQuestion(q, idx);
    s.answered = true;
    s.chosen = idx;
    s.answers.push(ok);
    try {
      store.markSeen(q.item.key, ok);
      if (ok) store.removeWrong(q.item.key);
      else store.addWrong({ key: q.item.key, word: q.item.word, level: q.item.level });
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[quiz] 写入进度失败', e);
    }
    paint();
    if (ok && s.auto) {
      clearAuto();
      autoTimer = setTimeout(function () {
        autoTimer = null;
        if (!disposed) next();
      }, AUTO_MS);
    }
  }

  function next() {
    clearAuto();
    if (s.phase !== 'running') return;
    s.answered = false;
    s.chosen = -1;
    s.index += 1;
    if (s.index >= s.questions.length) {
      finish();
      return;
    }
    paint();
  }

  function finish() {
    clearAuto();
    s.elapsedSec = Math.max(0, Math.round((Date.now() - s.startedAt) / 1000));
    s.phase = 'done';
    paint();
  }

  function abort() {
    clearAuto();
    s.phase = 'start';
    s.questions = [];
    s.index = 0;
    s.answers = [];
    s.answered = false;
    s.chosen = -1;
    paint();
    toast('已结束本组，答过的题已计入进度', 'ok');
  }

  function onKey(ev) {
    if (!ev || s.phase !== 'running') return;
    const key = ev.key;
    if (key === 'Escape' || key === 'Esc') {
      ev.preventDefault();
      abort();
      return;
    }
    if (!s.answered && (key === '1' || key === '2' || key === '3' || key === '4')) {
      const target = ev.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      ev.preventDefault();
      choose(Number(key) - 1);
      return;
    }
    if (s.answered && (key === 'Enter' || key === 'n' || key === 'N')) {
      const target = ev.target;
      if (target && target.tagName === 'BUTTON') return; // 让按钮本身处理回车，避免跳两题
      ev.preventDefault();
      next();
    }
  }

  paint();
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKey);

  return function cleanup() {
    disposed = true;
    clearAuto();
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKey);
  };
}

export const route = {
  name: 'quiz',
  title: '随机测试',
  mount: mount,
};

export default route;