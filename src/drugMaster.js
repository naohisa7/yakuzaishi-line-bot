const fs = require('fs');
const path = require('path');

/**
 * 医薬品マスタの検索モジュール
 *
 * data/drugs.json（支払基金の公式医薬品マスターから生成）を起動時に読み込み、
 * お薬手帳の登録画面で使う「薬品名＋規格」の候補検索を提供する。
 * マスタの薬品名には規格が含まれている（例：アムロジピン錠２．５ｍｇ「あすか」）。
 *
 * JSONの更新は scripts/build-drug-master.js を実行する。
 */

const MIN_QUERY_LENGTH = 3; // 3文字未満では検索しない（候補が多すぎて意味がないため）
const DEFAULT_LIMIT = 20;

/**
 * 検索用に文字列を正規化する
 * - NFKC：全角英数記号を半角へ（「２．５ｍｇ」→「2.5mg」、半角カナ→全角カナ）
 * - ひらがな→カタカナ（「たけきゃぶ」で「タケキャブ」を引けるように）
 * - 中黒・長音の表記ゆれを吸収し、小文字化
 *
 * 生成スクリプト側でも同じ関数を使うことで、索引と検索語の正規化を必ず一致させる。
 */
function normalizeForSearch(text) {
  return text
    .normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/ｰ/g, 'ー')
    .replace(/・/g, '')
    .toLowerCase();
}

/**
 * 医薬品マスタの薬品名からメーカー名（屋号）を取り除く
 *
 * マスタではメーカー名が「」で囲まれている（例：アムロジピン錠５ｍｇ「トーワ」、
 * ファモチジン錠１０「サワイ」　１０ｍｇ）。患者さんにとってメーカーの区別は難しく、
 * 候補が同じ薬で何十件にも膨らんでしまうため、患者さん向けの候補では取り除く。
 */
function stripManufacturer(name) {
  return name
    .replace(/「[^」]*」/g, '')
    .replace(/[\s　]+/g, ' ')
    .trim();
}

let fullIndex = null; // メーカー名込み（薬剤師用）
let simpleIndex = null; // メーカー名なし（患者さん用）

function load() {
  if (fullIndex) return;

  const jsonPath = path.join(__dirname, '../data/drugs.json');
  try {
    fullIndex = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch (err) {
    // マスタが無くてもサーバー全体は動くようにする（検索だけが空になる）
    console.error(`❌ 医薬品マスタを読み込めませんでした（${jsonPath}）:`, err.message);
    fullIndex = [];
  }

  // メーカー名を除いた同名のお薬は1件にまとめる
  const byBaseName = new Map();
  for (const drug of fullIndex) {
    const name = stripManufacturer(drug.n);
    if (!name || byBaseName.has(name)) continue;
    byBaseName.set(name, {
      n: name,
      // カナ名はメーカー分を含んだままだが、検索の当たりが増えるだけで害はない
      s: `${normalizeForSearch(name)} ${drug.s}`,
      u: drug.u,
    });
  }
  simpleIndex = [...byBaseName.values()];

  console.log(
    `💊 医薬品マスタを読み込みました（薬剤師用 ${fullIndex.length.toLocaleString()}件 / ` +
      `患者さん用 ${simpleIndex.length.toLocaleString()}件・メーカー名なし）`
  );
}

/**
 * 薬品名を検索する
 * @param {string} query - 検索語（3文字未満なら結果なし）
 * @param {object} [options]
 * @param {boolean} [options.includeManufacturer=true]
 *   true  … メーカー名込みの正式名称（薬剤師が登録するとき）
 *   false … メーカー名を除いた名称（患者さんが登録するとき。候補がすっきりする）
 * @param {number} [options.limit]
 * @returns {{ name: string, unit: string }[]} 前方一致を優先した候補
 */
function searchDrugs(query, options = {}) {
  const { includeManufacturer = true, limit = DEFAULT_LIMIT } = options;

  const raw = (query || '').trim();
  if (raw.length < MIN_QUERY_LENGTH) return [];

  load();
  const needle = normalizeForSearch(raw);
  const list = includeManufacturer ? fullIndex : simpleIndex;

  // 「アムロジ」で「アムロジピン錠…」が先に出るよう、前方一致を優先して並べる
  const prefixMatches = [];
  const partialMatches = [];

  for (const drug of list) {
    const index = drug.s.indexOf(needle);
    if (index === 0) {
      prefixMatches.push(drug);
      if (prefixMatches.length >= limit) break; // 前方一致だけで埋まったら打ち切ってよい
    } else if (index > 0 && partialMatches.length < limit) {
      partialMatches.push(drug);
    }
  }

  return [...prefixMatches, ...partialMatches]
    .slice(0, limit)
    .map((drug) => ({ name: drug.n, unit: drug.u }));
}

module.exports = { searchDrugs, normalizeForSearch, stripManufacturer, MIN_QUERY_LENGTH };
