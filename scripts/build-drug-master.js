/**
 * 医薬品マスタ（検索用JSON）を生成するスクリプト
 *
 *   node scripts/build-drug-master.js
 *
 * 社会保険診療報酬支払基金が公開している公式の医薬品マスター（全件ファイル）を
 * ダウンロードし、お薬手帳の検索に必要な項目だけを抜き出して data/drugs.json を作る。
 *
 * 診療報酬改定等でマスタが更新されたら、下の MASTER_URL を最新のものに差し替えて
 * このスクリプトを再実行し、生成された data/drugs.json をコミットするだけでよい。
 * 最新版のURLは下記ページで確認できる：
 *   https://www.ssk.or.jp/smph/seikyushiharai/tensuhyo/kihonmasta/r06/kihonmasta_04.html
 *
 * 医薬品マスタは薬品名フィールドに規格を含んだ形（例：アムロジピン錠２．５ｍｇ「あすか」）で
 * 収録されているため、規格を別項目として持つ必要はない。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { normalizeForSearch } = require('../src/drugMaster');

const MASTER_URL =
  'https://www.ssk.or.jp/seikyushiharai/tensuhyo/kihonmasta/r06/kihonmasta_04.files/y_r07_ALL20260317.zip';

const OUT_PATH = path.join(__dirname, '../data/drugs.json');

// 医薬品マスタのレコード内での列位置（0始まり）
const COL_MASTER_TYPE = 1; // マスター種別（医薬品は 'Y'）
const COL_NAME = 4; // 漢字名称（規格を含む薬品名）
const COL_KANA = 6; // カナ名称（半角カタカナ）
const COL_UNIT = 9; // 単位名称（錠・ｇ・ｍＬ など）

/**
 * ZIP（1ファイルのみ）から中身を取り出す
 *
 * 依存パッケージを増やさないためZIPを直接読む。支払基金のZIPはローカルファイルヘッダの
 * サイズ欄が0（データディスクリプタ方式）になっているため、必ず中央ディレクトリ側の
 * サイズを使うこと。
 */
function extractSingleFileFromZip(zipBuffer) {
  const END_OF_CENTRAL_DIR = 0x06054b50;
  const CENTRAL_FILE_HEADER = 0x02014b50;

  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= 0; i--) {
    if (zipBuffer.readUInt32LE(i) === END_OF_CENTRAL_DIR) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('ZIPの終端レコードが見つかりません');

  const centralOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  if (zipBuffer.readUInt32LE(centralOffset) !== CENTRAL_FILE_HEADER) {
    throw new Error('ZIPの中央ディレクトリが見つかりません');
  }

  const compressionMethod = zipBuffer.readUInt16LE(centralOffset + 10);
  const compressedSize = zipBuffer.readUInt32LE(centralOffset + 20);
  const localOffset = zipBuffer.readUInt32LE(centralOffset + 42);

  // 本体の開始位置はローカルファイルヘッダ側の名前・拡張フィールド長から求める
  const fileNameLength = zipBuffer.readUInt16LE(localOffset + 26);
  const extraFieldLength = zipBuffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + fileNameLength + extraFieldLength;
  const body = zipBuffer.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) return body; // 無圧縮
  if (compressionMethod === 8) return zlib.inflateRawSync(body); // deflate
  throw new Error(`未対応の圧縮方式です: ${compressionMethod}`);
}

/**
 * CSVの1行を分解する（値はダブルクォートで囲まれ、内部に改行は含まれない前提）
 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

async function main() {
  console.log(`医薬品マスタをダウンロードしています…\n  ${MASTER_URL}`);
  const res = await fetch(MASTER_URL);
  if (!res.ok) {
    throw new Error(`ダウンロードに失敗しました: HTTP ${res.status}`);
  }
  const zipBuffer = Buffer.from(await res.arrayBuffer());
  console.log(`  ${(zipBuffer.length / 1024).toFixed(0)}KB 取得`);

  const csvBuffer = extractSingleFileFromZip(zipBuffer);
  const csvText = new TextDecoder('shift_jis').decode(csvBuffer);

  const drugs = [];
  const seen = new Set();

  for (const line of csvText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols.length <= COL_UNIT || cols[COL_MASTER_TYPE] !== 'Y') continue;

    const name = cols[COL_NAME].trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);

    drugs.push({
      n: name,
      s: `${normalizeForSearch(name)} ${normalizeForSearch(cols[COL_KANA].trim())}`,
      u: cols[COL_UNIT].trim(),
    });
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const json = JSON.stringify(drugs, null, 0);
  fs.writeFileSync(OUT_PATH, json);

  console.log(`\n✅ ${OUT_PATH}`);
  console.log(`   ${drugs.length.toLocaleString()}件 / ${(json.length / 1024 / 1024).toFixed(2)}MB`);
  console.log(`   例: ${drugs.slice(0, 3).map((d) => d.n).join(' / ')}`);
}

main().catch((err) => {
  console.error('❌ 生成に失敗しました:', err.message);
  process.exit(1);
});
