#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/build-data.py - 从 .cache/ 原始文件生成 data/cet4.json / cet6.json / manifest.json

输入（.cache/）：
  CET4_T.json, DanCiDeJianFa_4.json, Level4luan_2_T.json   -> 四级
  CET6_T.json, DanCiDeJianFa_6.json                        -> 六级
  eng_sentences.tsv.bz2                                    -> 例句主源（Tatoeba）
  4000_Essential_English_Words-sentence.json                -> 例句退化源
  ecdict.csv                                                 -> 词性补全源（ECDICT）

只用标准库。用法：
  python scripts/build-data.py
"""
import bz2
import io
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
DATA = os.path.join(ROOT, "data")

LEVELS = [
    {
        "level": "cet4",
        "label": "四级",
        "books": ["CET4_T.json", "DanCiDeJianFa_4.json", "Level4luan_2_T.json"],
    },
    {
        "level": "cet6",
        "label": "六级",
        "books": ["CET6_T.json", "DanCiDeJianFa_6.json"],
    },
]

TATOEBA_BZ2 = os.path.join(CACHE, "eng_sentences.tsv.bz2")
ESSENTIAL_JSON = os.path.join(CACHE, "4000_Essential_English_Words-sentence.json")
ECDICT_CSV = os.path.join(CACHE, "ecdict.csv")

TAG_RE = re.compile(r"<[^>]*>")
# 词性标记：前置 "n. " 与后置 "(vt.)"（半/全角括号）两端都要认。长词在前，避免 vt 被 v 抢先。
_POS_ALT = r"vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|n|v"
POS_PREFIX_RE = re.compile(r"^(" + _POS_ALT + r")\.\s*", re.I)
POS_SUFFIX_RE = re.compile(r"\s*[(（](" + _POS_ALT + r")\.?[)）]\s*$", re.I)
POS_OK = frozenset("n. v. vt. vi. adj. adv. prep. conj. pron. num. art. int. aux.".split())
TOKEN_RE = re.compile(r"[a-z']+")
DIGIT_RE = re.compile(r"[0-9]")
URL_RE = re.compile(r"(https?://|www\.|\.(com|org|net|html))", re.I)

# 长度 <=3 且属于常见虚词：直接不匹配例句（规则 4）
STOP_SHORT = set(
    """a an i is it its in on at to of do be we he me my no so up us if or as by
    the and are was you your all any can not but for his her him she our out who
    how why yes let did has had have too one two off put own new old see now day
    man men way may get got go do does done use used per via vs etc""".split()
)


# ---------- ECDICT 词性补全 ----------
_ECDICT_POS_RE = re.compile(
    r"^(n|v|vt|vi|a|adj|adv|prep|conj|pron|num|art|int|interj|aux)\.", re.I
)
_ECDICT_POS_NORM = {
    "a": "adj.", "adj": "adj.", "interj": "int.", "int": "int.",
    "n": "n.", "v": "v.", "vt": "vt.", "vi": "vi.",
    "adv": "adv.", "prep": "prep.", "conj": "conj.",
    "pron": "pron.", "num": "num.", "art": "art.", "aux": "aux.",
}


def _parse_csv_line(line):
    """极简 CSV 解析：只处理双引号转义，够用。"""
    result = []
    current = []
    in_quotes = False
    i = 0
    while i < len(line):
        ch = line[i]
        if in_quotes:
            if ch == '"':
                if i + 1 < len(line) and line[i + 1] == '"':
                    current.append('"')
                    i += 1
                else:
                    in_quotes = False
            else:
                current.append(ch)
        else:
            if ch == '"':
                in_quotes = True
            elif ch == ',':
                result.append("".join(current))
                current = []
            else:
                current.append(ch)
        i += 1
    result.append("".join(current))
    return result


def load_ecdict_pos():
    """从 ECDICT CSV 提取 word -> pos 映射。

    ECDICT 的 pos 列几乎全空；词性信息在 translation 列的开头（如 "n. ..."、"a. ..."）。
    返回 dict，key 为小写单词，value 为规范化后的词性字符串（如 "n."、"adj."）。
    """
    if not os.path.exists(ECDICT_CSV):
        log("!! ECDICT CSV 不存在: " + ECDICT_CSV)
        return {}
    word_pos = {}
    total = 0
    with_pos = 0
    t0 = time.time()
    with io.open(ECDICT_CSV, "r", encoding="utf-8", errors="replace") as fh:
        header = fh.readline()  # skip header
        for line in fh:
            total += 1
            cols = _parse_csv_line(line.rstrip("\n").rstrip("\r"))
            if len(cols) < 4:
                continue
            word = cols[0].strip().lower()
            translation = cols[3]
            if not word or not translation:
                continue
            m = _ECDICT_POS_RE.match(translation)
            if m:
                raw_pos = m.group(1).lower()
                norm = _ECDICT_POS_NORM.get(raw_pos)
                if norm and word not in word_pos:
                    word_pos[word] = norm
                    with_pos += 1
    log("  ECDICT: " + str(total) + " 行, " + str(with_pos) + " 词有词性, "
        + str(len(word_pos)) + " 唯一, " + str(round(time.time() - t0, 1)) + "s")
    return word_pos


def merge_ecdict_pos(items, ecdict_pos):
    """对 pos 为 None 的词条，从 ECDICT 补全。返回补全数量。"""
    filled = 0
    for it in items:
        if it["pos"] is None:
            pos = ecdict_pos.get(it["word"])
            if pos:
                it["pos"] = pos
                filled += 1
    return filled


def log(*args):
    print(time.strftime("%H:%M:%S"), *args, flush=True)


def clean_text(s):
    if not isinstance(s, str):
        return ""
    s = TAG_RE.sub("", s)
    s = s.replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def normalize_ipa(s):
    """开头的 ' 规范成 ˈ；冒号后多余空格清理掉。"""
    if not isinstance(s, str):
        return ""
    s = s.strip()
    if not s:
        return ""
    s = s.replace("：", ":")
    # 源数据把主重音记作 ASCII 单引号（开头 7707 处、词中 6268 处）；
    # 契约只点名了开头，但两者是同一符号约定，一并规范成 ˈ 才能让同一份数据里
    # 不出现 "ˈkænsl" 与 "rɪ'viːlɪŋ" 混排。只换这一种字形，不动别的字符。
    # 逗号两种用途要先分开：紧跟重音符的那批是「同一词的两个读音」的分隔
    # （如 'eliən,'eljən、'kɑmplɛks,kəm'plɛks），统一成分号；剩下的逗号才是次重音 ˌ。
    s = re.sub(r",\s*(?=[\u02c8\u02cc'])", "; ", s)
    s = s.replace("'", "\u02c8")
    s = s.replace(",", "\u02cc")
    s = re.sub(r";\s*", "; ", s)
    s = re.sub(r":\s+", ":", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def load_book(name):
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        raise SystemExit("缺少源文件: " + path + "（先跑 node scripts/fetch-data.mjs）")
    with io.open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise SystemExit("源文件格式异常（期望数组）: " + name)
    return data


def merge_level(cfg):
    """按 word.lower().strip() 去重合并多本词书，保留首次出现的释义/音标。"""
    words = {}   # key -> record
    order = []
    for book in cfg["books"]:
        entries = load_book(book)
        added = 0
        for e in entries:
            if not isinstance(e, dict):
                continue
            w = clean_text(e.get("name", "")).lower().strip()
            if not w:
                continue
            uk = normalize_ipa(e.get("ukphone", ""))
            us = normalize_ipa(e.get("usphone", ""))
            trans = e.get("trans") or []
            if not isinstance(trans, list):
                trans = []
            if w not in words:
                words[w] = {"word": w, "uk": uk, "us": us, "trans": list(trans),
                             "variants": [list(trans)]}
                order.append(w)
                added += 1
            else:
                rec = words[w]
                # 跨词书回退用：按合并顺序留下各词书对该词的释义列表
                if trans:
                    rec["variants"].append(list(trans))
                # 首次音标为空则用后续非空音标补
                if not rec["uk"] and uk:
                    rec["uk"] = uk
                if not rec["us"] and us:
                    rec["us"] = us
                if not rec["trans"]:
                    rec["trans"] = list(trans)
        log("  " + book + ": " + str(len(entries)) + " 条, 新增 " + str(added) + " 词")
    return words, order


def split_pos(text):
    """剥掉两端的词性标记，返回 (规范词性 or None, 剥完的文本)。

    只动「标记」本身：前置 "^n. " 与后置 " (vt.)"（含全角括号），反复剥到不再命中。
    中文括号不是词性标记的（如「（布质）面罩」）不会被这里碰到。
    """
    s = text
    pos = None
    while True:
        hit = POS_PREFIX_RE.match(s)
        if not hit:
            break
        if pos is None:
            pos = hit.group(1).lower() + "."
        s = s[hit.end():]
    while True:
        hit = POS_SUFFIX_RE.search(s)
        if not hit:
            break
        if pos is None:
            pos = hit.group(1).lower() + "."
        s = s[:hit.start()]
    if pos is not None and pos not in POS_OK:
        pos = None
    return pos, s.strip()


def finalize_meanings(trans):
    """返回 (清洗后的释义列表, 释义里命中的第一个词性)。

    释义的词性标记提进 pos 后从文本剥离；剥完为空的丢弃（marker-only 释义）；
    全被丢弃时回退保留原文一条，保证 meanings 永不为空。
    """
    kept = []      # [(pos or None, 文本)]
    seen = set()
    first_raw = None
    for t in trans:
        raw = clean_text(t)
        if not raw:
            continue
        if first_raw is None:
            first_raw = raw
        p, body = split_pos(raw)
        if not body or body in seen:
            continue
        seen.add(body)
        kept.append((p, body))
        if len(kept) >= 3:
            break
    if not kept:
        return ([first_raw] if first_raw else []), None
    pos = None
    for p, _ in kept:
        if p:
            pos = p
            break
    return [b for _, b in kept], pos


def fallback_pos(variants):
    """本条释义没给词性时，按合并顺序去同级别其它词书里补，取第一条命中。"""
    for trans in variants:
        for t in trans:
            p, _ = split_pos(clean_text(t))
            if p:
                return p
    return None


def build_word_objects(cfg):
    raw, order = merge_level(cfg)
    items = []
    for w in order:
        rec = raw[w]
        meanings, pos = finalize_meanings(rec["trans"])
        if not meanings:
            continue  # 释义为空无法作为词条
        if pos is None:
            pos = fallback_pos(rec.get("variants") or [])
        ipa = rec["uk"] or rec["us"]
        ipa_us = rec["us"]
        obj = {"word": w, "ipa": ipa}
        if ipa_us and ipa_us != ipa:
            obj["ipaUs"] = ipa_us
        obj["meanings"] = meanings
        obj["pos"] = pos
        obj["example"] = None
        items.append(obj)
    return items


def candidate_forms(part):
    """由一个小写字母串反推 regex 允许的词形候选（WORD(s|es|ed|ing|d|'s)?）。"""
    yield part
    if part.endswith("s"):
        yield part[:-1]
    if part.endswith("es"):
        yield part[:-2]
    if part.endswith("ed"):
        yield part[:-2]
    if part.endswith("ing"):
        yield part[:-3]
    if part.endswith("d"):
        yield part[:-1]


def match_tatoeba(targets):
    """流式扫 Tatoeba 英文句库，为每个目标词保留 (token数, 句子id) 最小的句子。"""
    if not os.path.exists(TATOEBA_BZ2):
        return None
    best = {}          # word -> (ntok, sid, text)
    total = 0
    hits = 0
    t0 = time.time()
    with bz2.open(TATOEBA_BZ2, "rb") as raw:
        stream = io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline="\n")
        for line in stream:
            total += 1
            if total % 500000 == 0:
                log("    已扫 " + str(total) + " 句, 命中词 " + str(len(best)) + "/" + str(len(targets)) +
                    ", " + str(round(time.time() - t0, 1)) + "s")
            line = line.rstrip("\n").rstrip("\r")
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            sid_s, _lang, text = parts[0], parts[1], parts[2]
            if not sid_s.isdigit():
                continue  # 表头或异常行
            if DIGIT_RE.search(text):
                continue
            if "@" in text or URL_RE.search(text):
                continue
            ntok = text.count(" ") + 1
            if ntok < 4 or ntok > 18:
                continue
            sid = int(sid_s)
            found = None
            for tok in TOKEN_RE.findall(text.lower()):
                for part in tok.split("'"):
                    if not part:
                        continue
                    for cand in candidate_forms(part):
                        if cand in targets:
                            cur = best.get(cand)
                            if cur is None or (ntok, sid) < (cur[0], cur[1]):
                                best[cand] = (ntok, sid, text)
                            found = cand
            if found is not None:
                hits += 1
    log("    Tatoeba 扫描完成: " + str(total) + " 行, 覆盖词 " + str(len(best)) + "/" + str(len(targets)) +
        ", " + str(round(time.time() - t0, 1)) + "s")
    return best


def match_essential(targets):
    """退化源：按 name 对齐。"""
    if not os.path.exists(ESSENTIAL_JSON):
        return None
    with io.open(ESSENTIAL_JSON, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    best = {}
    for e in data:
        if not isinstance(e, dict):
            continue
        w = clean_text(e.get("name", "")).lower().strip()
        if not w or w not in targets:
            continue
        trans = e.get("trans") or []
        if not isinstance(trans, list):
            continue
        for t in trans:
            text = clean_text(t)
            if not text:
                continue
            ntok = text.count(" ") + 1
            cur = best.get(w)
            if cur is None or ntok < cur[0]:
                best[w] = (ntok, 0, text)
            break
    log("    4000essential 覆盖词 " + str(len(best)) + "/" + str(len(targets)))
    return best if best else None


def main():
    os.makedirs(DATA, exist_ok=True)
    t_start = time.time()

    log("== 合并词条 ==")
    per_level = {}
    for cfg in LEVELS:
        log(cfg["level"] + " (" + cfg["label"] + "):")
        items = build_word_objects(cfg)
        per_level[cfg["level"]] = items
        log("  -> " + str(len(items)) + " 词")

    log("== ECDICT 词性补全 ==")
    ecdict_pos = load_ecdict_pos()
    if ecdict_pos:
        for cfg in LEVELS:
            lvl = cfg["level"]
            items = per_level[lvl]
            before = sum(1 for it in items if it["pos"])
            filled = merge_ecdict_pos(items, ecdict_pos)
            after = sum(1 for it in items if it["pos"])
            log("  " + lvl + ": 补全 " + str(filled) + " 词 (" + str(before) + " -> " + str(after) + ")")

    all_targets = set()
    for items in per_level.values():
        for it in items:
            if len(it["word"]) <= 3 and it["word"] in STOP_SHORT:
                continue
            all_targets.add(it["word"])
    log("待匹配例句的唯一词形: " + str(len(all_targets)))

    log("== 例句匹配 ==")
    src_used = "tatoeba"
    best = match_tatoeba(all_targets)
    if not best:
        log("!! Tatoeba 主源不可用/无命中，切换退化源 4000essential")
        best = match_essential(all_targets) or {}
        src_used = "4000essential"
    if not best:
        log("!! 两个例句源都不可用，example 全部为 null")
        src_used = "none"

    log("== 写文件 ==")
    # 契约示例是 Z 结尾的 UTC ISO 串；统一按 UTC 输出，避免带 +08:00 偏移
    now_utc = datetime.now(timezone.utc)
    updated_at = now_utc.strftime("%Y-%m-%d")
    generated_at = now_utc.isoformat(timespec="milliseconds").replace("+00:00", "Z")

    manifest_levels = {}
    for cfg in LEVELS:
        lvl = cfg["level"]
        items = per_level[lvl]
        with_ipa = 0
        with_ex = 0
        with_pos = 0
        for it in items:
            w = it["word"]
            hit = best.get(w)
            it["example"] = {"en": hit[2], "src": src_used} if hit else None
            if it["ipa"]:
                with_ipa += 1
            if it["example"]:
                with_ex += 1
            if it["pos"]:
                with_pos += 1
        payload = {
            "level": lvl,
            "label": cfg["label"],
            "updatedAt": updated_at,
            "words": items,
        }
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        if "</script" in text.lower():
            raise SystemExit("输出包含 </script> 字面量，需转义")
        out = os.path.join(DATA, lvl + ".json")
        with io.open(out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        size = os.path.getsize(out)
        manifest_levels[lvl] = {
            "label": cfg["label"],
            "file": lvl + ".json",
            "count": len(items),
            "withIpa": with_ipa,
            "withExample": with_ex,
            "withPos": with_pos,
        }
        log("  " + out + "  " + str(size) + "B  count=" + str(len(items)) +
            " withIpa=" + str(with_ipa) + " withExample=" + str(with_ex) +
            " withPos=" + str(with_pos))

    manifest = {
        "generatedAt": generated_at,
        "levels": manifest_levels,
        "sources": [
            {
                "name": "qwerty-learner CET4_T / DanCiDeJianFa_4 / Level4luan_2_T",
                "url": "https://github.com/Kaiyiwing/qwerty-learner/tree/master/public/dicts",
                "license": "MIT",
            },
            {
                "name": "qwerty-learner CET6_T / DanCiDeJianFa_6",
                "url": "https://github.com/Kaiyiwing/qwerty-learner/tree/master/public/dicts",
                "license": "MIT",
            },
            {
                "name": "Tatoeba 英文句库 eng_sentences",
                "url": "https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2",
                "license": "CC-BY 2.0 FR",
            },
            {
                "name": "ECDICT 词库 ecdict.csv",
                "url": "https://github.com/skywind3000/ECDICT",
                "license": "MIT",
            },
        ],
    }
    mpath = os.path.join(DATA, "manifest.json")
    mtext = json.dumps(manifest, ensure_ascii=False, indent=2)
    with io.open(mpath, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(mtext + "\n")
    log("  " + mpath + "  " + str(os.path.getsize(mpath)) + "B")
    log("完成，总耗时 " + str(round(time.time() - t_start, 1)) + "s，例句源=" + src_used)


if __name__ == "__main__":
    main()
