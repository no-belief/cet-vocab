/* features/wrong.js — 错词回顾（owner: S5）
 * 纯逻辑具名导出，便于 node 自测；顶层只有 import 与 const，不碰 document/localStorage。
 */
import { store } from '../core/store.js';
import { bank } from '../core/bank.js';
import { router } from '../core/router.js';
import { el, emptyState, toast } from '../core/util.js';
import { ipaText, meaningsText, exampleText, relTime } from './quiz.js';

/* ================= 纯逻辑 ================= */

export function levelLabel(level) {
  if (level === 'cet4') return '四级';
  if (level === 'cet6') return '六级';
  return level ? String(level) : '—';
}

/** → {count, byLevel:{cet4:n,cet6:n}, levels:[{level,count}]} */
export function wrongStats(list) {
  const arr = Array.isArray(list) ? list : [];
  const byLevel = {};
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    const lv = it && it.level ? String(it.level) : '';
    if (!lv) continue;
    byLevel[lv] = (byLevel[lv] || 0) + 1;
  }
  const levels = [];
  const keys = Object.keys(byLevel);
  for (let i = 0; i < keys.length; i++) levels.push({ level: keys[i], count: byLevel[keys[i]] });
  return { count: arr.length, byLevel: byLevel, levels: levels };
}

/** 复制一份错词列表作为复习卡组（顺序 = store.wrong() 的最近优先） */
export function deckOf(list) {
  return Array.isArray(list) ? list.slice() : [];
}

function statEl(num, label) {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'stat__num', text: String(num) }),
    el('span', { class: 'stat__label', text: String(label) }),
  ]);
}

function chipEl(level) {
  const cls = level === 'cet4' ? 'chip chip--cet4' : level === 'cet6' ? 'chip chip--cet6' : 'chip';
  return el('span', { class: cls, text: levelLabel(level) });
}

function mount(root) {
  const s = {
    view: 'list', // list | review | done
    list: [],
    bankTried: false,
    confirmClear: false,
    deck: [],
    idx: 0,
    flipped: false,
    remembered: 0,
  };

  let disposed = false;
  let keyHandler = null;

  function refresh() {
    let list = [];
    try { list = store.wrong(); } catch (e) { list = []; }
    s.list = Array.isArray(list) ? list : [];
    return s.list;
  }

  /** 用 bank.word 补全词条；未加载的 level 先 load */
  function itemOf(entry) {
    if (!entry) return { word: '' };
    const w = bank.word(entry.level, entry.key);
    return w || { word: entry.word || '', level: entry.level };
  }

  async function loadBankData() {
    const levels = [];
    for (let i = 0; i < s.list.length; i++) {
      const lv = s.list[i] && s.list[i].level ? String(s.list[i].level) : '';
      if (lv && levels.indexOf(lv) < 0) levels.push(lv);
    }
    let failed = false;
    for (let i = 0; i < levels.length; i++) {
      try { await bank.load(levels[i]); } catch (e) { failed = true; }
    }
    return !failed;
  }

  function paint() {
    if (disposed || !root) return;
    root.innerHTML = '';
    if (s.view === 'review') { root.appendChild(viewReview()); return; }
    if (s.view === 'done') { root.appendChild(viewReviewDone()); return; }
    refresh();
    root.appendChild(viewList());
    if (!s.bankTried) {
      s.bankTried = true;
      void loadBankData().then(function (ok) {
        if (disposed) return;
        if (!ok) toast('词库加载失败，词条信息可能显示不全', 'err');
        paint();
      });
    }
  }

  /* ---------- 列表 ---------- */
  function viewList() {
    const wrap = el('div', { class: 'wrong' });
    const st = wrongStats(s.list);

    wrap.appendChild(
      el('section', { class: 'panel wrong-intro' }, [
        el('h2', { class: 'wrong-intro__title', text: '错词本' }),
        el('p', {
          class: 'wrong-intro__desc',
          text: '答错过的词会自动收集到这里。在集中复习里点「记住了」的词会移出错词本；随机测试里答对一次也会移出。',
        }),
      ])
    );

    if (!s.list.length) {
      const box = emptyState('错词本是空的', '去随机测试里练几组，答错的词会自动进这里');
      box.appendChild(
        el('button', {
          type: 'button',
          class: 'btn btn--primary wrong-empty__btn',
          text: '去随机测试',
          onClick: function () { router.go('quiz'); },
        })
      );
      wrap.appendChild(box);
      return wrap;
    }

    wrap.appendChild(
      el('div', { class: 'stat-grid wrong-stats' }, [
        statEl(st.count, '错词数'),
        statEl(st.byLevel.cet4 || 0, '四级'),
        statEl(st.byLevel.cet6 || 0, '六级'),
      ])
    );

    const bar = el('div', { class: 'wrong-toolbar' }, [
      el('button', { type: 'button', class: 'btn btn--primary', text: '开始集中复习', onClick: startReview }),
    ]);
    if (s.confirmClear) {
      bar.appendChild(
        el('button', {
          type: 'button',
          class: 'btn btn--danger',
          text: '确认清空（' + String(st.count) + '）',
          onClick: function () {
            try { store.clearWrong(); } catch (e) { /* 忽略 */ }
            s.confirmClear = false;
            refresh();
            paint();
            toast('错词本已清空', 'ok');
          },
        })
      );
      bar.appendChild(
        el('button', {
          type: 'button',
          class: 'btn btn--sm',
          text: '取消',
          onClick: function () { s.confirmClear = false; paint(); },
        })
      );
    } else {
      bar.appendChild(
        el('button', {
          type: 'button',
          class: 'btn btn--sm',
          text: '清空全部',
          onClick: function () { s.confirmClear = true; paint(); },
        })
      );
    }
    wrap.appendChild(bar);

    const list = el('ul', { class: 'wrong-list' });
    for (let i = 0; i < s.list.length; i++) list.appendChild(rowEl(s.list[i]));
    wrap.appendChild(list);

    wrap.appendChild(
      el('p', { class: 'wrong-foot', text: '共 ' + String(st.count) + ' 个错词。清空需要再点一次「确认清空」。' })
    );
    return wrap;
  }

  function rowEl(entry) {
    const item = itemOf(entry);
    const parts = [];
    const ipa = ipaText(item);
    if (ipa) parts.push(ipa);
    const mean = meaningsText(item);
    if (mean) parts.push(mean);
    const ex = exampleText(item);

    const head = el('div', { class: 'wrong-row__head' }, [
      el('span', { class: 'wrong-row__word', text: String(item.word || entry.word || '—') }),
      chipEl(entry.level),
      el('span', { class: 'wrong-row__count', text: '错 ' + String(entry.count) + ' 次' }),
    ]);

    const meta = el('p', { class: 'wrong-row__meta', text: '最近 ' + relTime(entry.lastAt) });

    const main = el('div', { class: 'wrong-row__main' }, [
      head,
      el('p', { class: 'wrong-row__sub', text: parts.length ? parts.join(' · ') : '（词库尚未加载该词条）' }),
      meta,
    ]);

    const exBox = el('p', { class: 'wrong-row__example', hidden: true, text: ex });

    const actions = el('div', { class: 'wrong-row__actions' });
    if (ex) {
      const exBtn = el('button', {
        type: 'button',
        class: 'btn btn--sm',
        'aria-expanded': 'false',
        'aria-controls': 'wrong-ex-' + String(entry.key).replace(/[^a-zA-Z0-9_-]/g, '-'),
        text: '例句',
      });
      exBox.id = exBtn.getAttribute('aria-controls');
      exBtn.addEventListener('click', function () {
        const open = exBox.hidden;
        exBox.hidden = !open;
        exBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        exBtn.classList.toggle('is-on', open);
        exBtn.textContent = open ? '收起例句' : '例句';
      });
      actions.appendChild(exBtn);
    }
    actions.appendChild(
      el('button', {
        type: 'button',
        class: 'btn btn--sm wrong-row__remove',
        'aria-label': '从错词本移除 ' + String(item.word || entry.word || ''),
        text: '移除',
        onClick: function () {
          try { store.removeWrong(entry.key); } catch (e) { /* 忽略 */ }
          refresh();
          paint();
          toast('已移除', 'ok');
        },
      })
    );

    const row = el('li', { class: 'wrong-row', dataset: { key: entry.key } }, [main, actions]);
    if (ex) row.appendChild(exBox);
    return row;
  }

  /* ---------- 集中复习 ---------- */
  function startReview() {
    refresh();
    if (!s.list.length) {
      toast('错词本是空的', 'info');
      return;
    }
    s.deck = deckOf(s.list);
    s.idx = 0;
    s.flipped = false;
    s.remembered = 0;
    s.view = 'review';
    paint();
    void loadBankData().then(function () {
      if (!disposed) paint();
    });
  }

  function answerReview(ok) {
    const entry = s.deck[s.idx];
    if (!entry) return;
    try {
      if (ok) {
        store.markSeen(entry.key, true);
        store.removeWrong(entry.key);
        s.remembered += 1;
      } else {
        store.markSeen(entry.key, false);
      }
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[wrong] 写入进度失败', e);
    }
    s.idx += 1;
    s.flipped = false;
    if (s.idx >= s.deck.length) {
      s.view = 'done';
      paint();
      return;
    }
    paint();
  }

  function viewReview() {
    const wrap = el('div', { class: 'wrong' });
    const total = s.deck.length;
    const entry = s.deck[s.idx] || {};
    const item = itemOf(entry);
    const progress = total ? Math.round((s.idx / total) * 100) : 0;

    wrap.appendChild(
      el('div', { class: 'wrong-review__head' }, [
        el('span', { class: 'wrong-review__idx', text: '第 ' + String(s.idx + 1) + ' / ' + String(total) + ' 个错词' }),
        el('span', { class: 'wrong-review__meta', text: '记住 ' + String(s.remembered) + ' 个' }),
      ])
    );
    wrap.appendChild(
      el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(progress) }, [
        el('span', { class: 'progress__bar', style: { width: progress + '%' } }),
      ])
    );

    const card = el('section', { class: 'panel wrong-card' + (s.flipped ? ' is-flipped' : ''), 'aria-live': 'polite' });
    if (!s.flipped) {
      card.appendChild(
        el('div', { class: 'wrong-card__face wrong-card__front' }, [
          el('div', { class: 'wrong-card__head' }, [
            el('span', { class: 'wrong-card__word', text: String(item.word || entry.word || '—') }),
            chipEl(entry.level),
          ]),
          el('p', { class: 'wrong-card__ipa', text: ipaText(item) || '（无音标）' }),
          el('p', { class: 'wrong-card__tip', text: '按 Enter / 空格 或点「显示释义」翻面' }),
        ])
      );
    } else {
      const back = el('div', { class: 'wrong-card__face wrong-card__back' });
      const mean = meaningsText(item);
      const pos = item && item.pos ? String(item.pos) : '';
      back.appendChild(
        el('div', { class: 'wrong-card__head' }, [
          el('span', { class: 'wrong-card__word', text: String(item.word || entry.word || '—') }),
          chipEl(entry.level),
        ])
      );
      back.appendChild(el('p', { class: 'wrong-card__mean', text: (pos ? pos + ' ' : '') + (mean || '（词库尚未加载释义）') }));
      const ex = exampleText(item);
      if (ex) back.appendChild(el('p', { class: 'wrong-card__ex', text: ex }));
      back.appendChild(
        el('p', { class: 'wrong-card__tip', text: '错 ' + String(entry.count) + ' 次 · 最近 ' + relTime(entry.lastAt) })
      );
      card.appendChild(back);
    }
    wrap.appendChild(card);

    wrap.appendChild(
      el('div', { class: 'wrong-review__actions' }, [
        el('button', {
          type: 'button',
          class: 'btn',
          text: s.flipped ? '看单词' : '显示释义',
          onClick: function () { s.flipped = !s.flipped; paint(); },
        }),
        el('button', {
          type: 'button',
          class: 'btn btn--primary',
          text: '记住了',
          onClick: function () { answerReview(true); },
        }),
        el('button', {
          type: 'button',
          class: 'btn',
          text: '还是不熟',
          onClick: function () { answerReview(false); },
        }),
      ])
    );

    wrap.appendChild(
      el('button', {
        type: 'button',
        class: 'btn btn--ghost wrong-review__exit',
        text: '结束复习，回到错词本',
        onClick: function () { s.view = 'list'; paint(); },
      })
    );
    wrap.appendChild(
      el('p', { class: 'wrong-foot', text: '键盘：Enter / 空格 翻面，1 = 记住了，2 = 还是不熟。' })
    );
    return wrap;
  }

  function viewReviewDone() {
    const reviewed = s.deck.length;
    const wrap = el('div', { class: 'wrong' });
    wrap.appendChild(
      el('section', { class: 'panel wrong-intro' }, [
        el('h2', { class: 'wrong-intro__title', text: '这一轮复习完成' }),
        el('p', { class: 'wrong-intro__desc', text: '复习了 ' + String(reviewed) + ' 个错词，其中 ' + String(s.remembered) + ' 个点了「记住了」并移出错词本。' }),
        el('div', { class: 'stat-grid wrong-stats' }, [
          statEl(reviewed, '复习'),
          statEl(s.remembered, '记住了'),
          statEl(reviewed - s.remembered, '仍留错词本'),
        ]),
      ])
    );
    wrap.appendChild(
      el('div', { class: 'wrong-toolbar' }, [
        el('button', { type: 'button', class: 'btn btn--primary', text: '回到错词本', onClick: function () { s.view = 'list'; paint(); } }),
        el('button', {
          type: 'button',
          class: 'btn',
          text: '再复习剩下的',
          onClick: function () { s.view = 'list'; startReview(); },
        }),
        el('button', { type: 'button', class: 'btn', text: '去随机测试', onClick: function () { router.go('quiz'); } }),
      ])
    );
    return wrap;
  }

  function onKey(ev) {
    if (!ev || s.view !== 'review') return;
    const key = ev.key;
    const tag = ev.target && ev.target.tagName;
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      if (tag === 'BUTTON') return; // 交给按钮自身，避免翻面两次
      ev.preventDefault();
      s.flipped = !s.flipped;
      paint();
      return;
    }
    if (key === '1' || key === 'ArrowRight') {
      ev.preventDefault();
      answerReview(true);
      return;
    }
    if (key === '2' || key === 'ArrowLeft') {
      ev.preventDefault();
      answerReview(false);
    }
  }

  paint();
  if (typeof document !== 'undefined') {
    keyHandler = onKey;
    document.addEventListener('keydown', keyHandler);
  }

  return function cleanup() {
    disposed = true;
    if (keyHandler && typeof document !== 'undefined') document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  };
}

export const route = {
  name: 'wrong',
  title: '错词本',
  mount: mount,
};

export default route;
