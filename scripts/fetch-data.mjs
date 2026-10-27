#!/usr/bin/env node
/**
 * scripts/fetch-data.mjs - 可复现的数据下载脚本
 *
 * 环境事实（Lead 实测，勿改）：
 *  - 只有 Node 的 fetch 能联网；curl.exe 在此环境返回 0 字节，不可用。
 *  - 单次大文件 fetch 必然中断（>3MB），必须走 HTTP Range 分块。
 *  - 吞吐约 40~85KB/s；并行分块可把聚合吞吐拉到 ~80KB/s。
 *
 * 策略：
 *  - 小词条 JSON（<1MB）：整取，失败重试 3 次。
 *  - 大语料 bz2（24.9MB）：1MB 分块 + 并发池（默认 8）+ 每块 3 次重试。
 *    每块落一个 part 文件（先写 .tmp 再 rename，原子替换），所以
 *    "已存在且大小正确的 part 文件"天然就是断点续传的进度记录：
 *    重新跑本脚本只会补下缺失的块，不会重下已完成的部分。
 *  - 全部块齐了再顺序拼接到最终文件，并校验总字节数。
 *
 * 用法：
 *   node scripts/fetch-data.mjs            # 增量（可反复跑，自动续传）
 *   node scripts/fetch-data.mjs --force    # 忽略已有缓存，全部重下
 *   node scripts/fetch-data.mjs --verify   # 只校验缓存完整性，不下载
 */
import { mkdir, stat, writeFile, rename, readFile, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache");
const PART_ROOT = path.join(CACHE, "parts");

const FORCE = process.argv.includes("--force");
const VERIFY_ONLY = process.argv.includes("--verify");

const CHUNK_SIZE = 1024 * 1024; // 1MB/块
const CONCURRENCY = 8;
const RETRIES = 3;
const CHUNK_TIMEOUT_MS = 240000;
const FILE_TIMEOUT_MS = 180000;

/** 小词条源：整取 */
const DICTS = [
  { file: "CET4_T.json", url: "https://raw.githubusercontent.com/Kaiyiwing/qwerty-learner/master/public/dicts/CET4_T.json" },
  { file: "DanCiDeJianFa_4.json", url: "https://raw.githubusercontent.com/Kaiyiwing/qwerty-learner/master/public/dicts/DanCiDeJianFa_4.json" },
  { file: "Level4luan_2_T.json", url: "https://raw.githubusercontent.com/Kaiyiwing/qwerty-learner/master/public/dicts/Level4luan_2_T.json" },
  { file: "CET6_T.json", url: "https://raw.githubusercontent.com/Kaiyiwing/qwerty-learner/master/public/dicts/CET6_T.json" },
  { file: "DanCiDeJianFa_6.json", url: "https://raw.githubusercontent.com/Kaiyiwing/qwerty-learner/master/public/dicts/DanCiDeJianFa_6.json" },
  // 退化方案用的例句源：主源失败时才需要，同样缓存下来备用
  { file: "4000_Essential_English_Words-sentence.json", url: "https://raw.githubusercontent.com/Kaiyiwing/qwerty-learner/master/public/dicts/4000_Essential_English_Words-sentence.json" },
];

/** 大语料源：Range 分块 */
const CORPUS = [
  {
    file: "eng_sentences.tsv.bz2",
    url: "https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2",
  },
];

function log() {
  const args = Array.prototype.slice.call(arguments);
  console.log.apply(console, [new Date().toISOString().slice(11, 19)].concat(args));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sizeOf(p) {
  try {
    return (await stat(p)).size;
  } catch (e) {
    return -1;
  }
}

/** 用 Range 探测远端总字节数 */
async function probeTotal(url) {
  const res = await fetch(url, {
    headers: { Range: "bytes=0-0" },
    signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
  });
  const cr = res.headers.get("content-range");
  const m = cr ? /\/(\d+)\s*$/.exec(cr) : null;
  const len = res.headers.get("content-length");
  if (res.body) { try { await res.body.cancel(); } catch (e) {} }
  if (res.status === 206 && m) return Number(m[1]);
  if (len) return Number(len);
  throw new Error("无法探测远端大小: " + url);
}

/** 整取一个小文件 */
async function fetchWhole(url, dest) {
  let lastErr = null;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error("0 字节");
      JSON.parse(buf.toString("utf-8")); // 顺带校验 JSON 完整性
      const tmp = dest + ".tmp";
      await writeFile(tmp, buf);
      await rename(tmp, dest);
      log("OK   " + path.basename(dest) + "  " + buf.length + "B  " + ((Date.now() - t0) / 1000).toFixed(1) + "s (try " + attempt + ")");
      return true;
    } catch (e) {
      lastErr = e;
      log("WARN " + path.basename(dest) + " 第 " + attempt + "/" + RETRIES + " 次失败: " + String(e && e.message || e).slice(0, 100));
      if (attempt < RETRIES) await sleep(2000 * attempt);
    }
  }
  log("FAIL " + path.basename(dest) + ": " + String(lastErr && lastErr.message || lastErr));
  return false;
}

/** 下载单个 1MB 分块到 part 文件 */
async function fetchPart(url, partPath, start, len, tag) {
  const tmp = partPath + ".tmp";
  let lastErr = null;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        headers: { Range: "bytes=" + start + "-" + (start + len - 1) },
        signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
      });
      if (res.status !== 206) throw new Error("status " + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length !== len) throw new Error("分块字节不足 " + buf.length + "/" + len);
      await writeFile(tmp, buf);
      await rename(tmp, partPath);
      const sec = (Date.now() - t0) / 1000;
      log(tag + " " + (len / 1024).toFixed(0) + "KB " + sec.toFixed(1) + "s " + (len / 1024 / sec).toFixed(0) + "KB/s (try " + attempt + ")");
      return true;
    } catch (e) {
      lastErr = e;
      log(tag + " 第 " + attempt + "/" + RETRIES + " 次失败: " + String(e && e.message || e).slice(0, 100));
      if (attempt < RETRIES) await sleep(1500 * attempt);
    }
  }
  log(tag + " FAIL: " + String(lastErr && lastErr.message || lastErr));
  return false;
}

/** 分块 + 并发池 + 断点续传 地下载一个大文件 */
async function fetchChunked(item) {
  const dest = path.join(CACHE, item.file);
  const partsDir = path.join(PART_ROOT, item.file);

  const total = await probeTotal(item.url);
  const nParts = Math.ceil(total / CHUNK_SIZE);
  const chunkLen = (i) => Math.min(CHUNK_SIZE, total - i * CHUNK_SIZE);
  log(item.file + ": 远端 " + total + "B = " + (total / 1048576).toFixed(1) + "MB, " + nParts + " 块 @1MB, 并发 " + CONCURRENCY);

  if (!FORCE && (await sizeOf(dest)) === total) {
    log(item.file + ": 已完整缓存 (" + total + "B)，跳过");
    return true;
  }
  if (VERIFY_ONLY) {
    log(item.file + ": 缓存不完整（现有 " + (await sizeOf(dest)) + "B / 期望 " + total + "B）");
    return false;
  }

  await mkdir(partsDir, { recursive: true });

  // 断点续传：扫描已有且大小正确的 part 文件
  const present = new Set();
  for (let i = 0; i < nParts; i++) {
    const p = path.join(partsDir, String(i).padStart(4, "0") + ".part");
    if ((await sizeOf(p)) === chunkLen(i)) present.add(i);
  }
  if (present.size) log("断点续传：已有 " + present.size + "/" + nParts + " 块，只需补 " + (nParts - present.size) + " 块");

  const queue = [];
  for (let i = 0; i < nParts; i++) if (!present.has(i)) queue.push(i);

  let ok = 0;
  let failed = 0;
  const t0 = Date.now();
  async function worker() {
    while (queue.length) {
      const i = queue.shift();
      const p = path.join(partsDir, String(i).padStart(4, "0") + ".part");
      const good = await fetchPart(item.url, p, i * CHUNK_SIZE, chunkLen(i), "part " + (i + 1) + "/" + nParts);
      if (good) ok++;
      else failed++;
    }
  }
  const nWorkers = Math.max(1, Math.min(CONCURRENCY, queue.length));
  await Promise.all(Array.from({ length: nWorkers }, () => worker()));
  log(item.file + ": 本轮 " + ok + " 块成功 / " + failed + " 块失败，用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");

  if (failed > 0) {
    log(item.file + ": 尚有 " + failed + " 块未完成，重跑本脚本可续传");
    return false;
  }

  // 顺序拼接
  const fh = await open(dest, "w");
  try {
    for (let i = 0; i < nParts; i++) {
      const p = path.join(partsDir, String(i).padStart(4, "0") + ".part");
      const buf = await readFile(p);
      if (buf.length !== chunkLen(i)) throw new Error("拼接时第 " + i + " 块大小异常 " + buf.length + "/" + chunkLen(i));
      await fh.write(buf);
    }
  } finally {
    await fh.close();
  }
  const got = await sizeOf(dest);
  if (got !== total) {
    log(item.file + ": 拼接后大小不符 " + got + "/" + total);
    return false;
  }
  log(item.file + ": 完成 " + got + "B，part 缓存保留在 " + partsDir);
  return true;
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  const failures = [];

  for (const d of DICTS) {
    const dest = path.join(CACHE, d.file);
    if (!FORCE && (await sizeOf(dest)) > 0) {
      try {
        JSON.parse(await readFile(dest, "utf-8"));
        log("SKIP " + d.file + ": 已缓存 " + (await sizeOf(dest)) + "B（JSON 可解析）");
        continue;
      } catch (e) {
        log("WARN " + d.file + ": 缓存损坏，重下");
      }
    }
    if (VERIFY_ONLY) {
      failures.push(d.file);
      continue;
    }
    if (!(await fetchWhole(d.url, dest))) failures.push(d.file);
  }

  for (const c of CORPUS) {
    const ok = await fetchChunked(c).catch((e) => {
      log(c.file + " 异常: " + String(e && e.message || e));
      return false;
    });
    if (!ok) failures.push(c.file);
  }

  if (failures.length) {
    log("未完成: " + failures.join(", "));
    process.exitCode = 1;
  } else {
    log("全部源文件已就位于 .cache/");
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});
