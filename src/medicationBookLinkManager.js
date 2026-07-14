const crypto = require('crypto');
const redis = require('./redisClient');

/**
 * お薬手帳をLINEとホームページで同期するための紐づけモジュール（Redisに永続化）
 *
 * 同じ患者さんでも、LINEは `line:<userId>`、ホームページは `web:<sessionId>` という
 * 別々のキーで扱われるため、放っておくとお薬手帳が2冊できてしまう。
 * ここで「この web: の人は、この line: の人と同一人物」と紐づけ、1冊を共有させる。
 *
 * 正となるキーは常にLINE側（line:<userId>）。LINEのuserIdは変わらないが、
 * ホームページのsessionIdは再ログインで変わってしまうため。
 *
 * ※ お薬手帳のレコード自体の読み書きは medicationRecordManager.js が持つ。
 *   このモジュールは循環参照を避けるため、Redisを直接読み書きしてマージする。
 */

const LINK_CODE_TTL_SECONDS = 10 * 60; // 10分
const RECORD_TTL_SECONDS = 365 * 24 * 60 * 60; // 1年（medicationRecordManagerと揃える）

function linkKey(webKey) {
  return `medbooklink:${webKey}`; // web:<sid> → line:<uid>
}

function reverseLinkKey(lineKey) {
  return `medbooklink_web:${lineKey}`; // line:<uid> → web:<sid>
}

function linkCodeKey(code) {
  return `medbookcode:${code}`;
}

function recordKey(patientKey) {
  return `medications:${patientKey}`;
}

/**
 * お薬手帳の実体がどのキーに入っているかを解決する
 * 紐づけ済みのホームページ患者は、LINE側のキー（＝正）を返す
 */
async function resolveBookKey(patientKey) {
  if (!patientKey || !patientKey.startsWith('web:')) return patientKey;
  const linked = await redis.get(linkKey(patientKey));
  return linked || patientKey;
}

async function getLinkedLineKey(webKey) {
  if (!webKey || !webKey.startsWith('web:')) return null;
  return redis.get(linkKey(webKey));
}

async function getLinkedWebKey(lineKey) {
  if (!lineKey || !lineKey.startsWith('line:')) return null;
  return redis.get(reverseLinkKey(lineKey));
}

async function readRecords(patientKey) {
  const raw = await redis.get(recordKey(patientKey));
  return raw ? JSON.parse(raw) : [];
}

async function writeRecords(patientKey, list) {
  await redis.set(recordKey(patientKey), JSON.stringify(list), 'EX', RECORD_TTL_SECONDS);
}

/** 薬剤師の手帳と患者さんの手帳の区分を保ったまま、2つのお薬手帳を1冊にまとめる */
function mergeRecords(primary, secondary) {
  const merged = [...primary];

  for (const record of secondary) {
    const isPharmacist = record.source === 'pharmacist';
    const duplicated = merged.some(
      (m) => m.name === record.name && (m.source === 'pharmacist') === isPharmacist
    );
    if (!duplicated) merged.push(record);
  }

  // 新しい順に並べ直す（登録日時が無い古いレコードは末尾へ）
  return merged.sort((a, b) => new Date(b.recordedAt || 0) - new Date(a.recordedAt || 0));
}

/**
 * ホームページの患者さんとLINEの患者さんを同一人物として紐づけ、お薬手帳を1冊に統合する
 * @returns {{ ok: boolean, error?: string, merged?: number }}
 */
async function linkBooks(webKey, lineKey) {
  if (!webKey || !webKey.startsWith('web:') || !lineKey || !lineKey.startsWith('line:')) {
    return { ok: false, error: '紐づけできる組み合わせではありません。' };
  }

  // すでに別のホームページ患者と紐づいているLINE患者には、二重に紐づけない
  const existingWeb = await getLinkedWebKey(lineKey);
  if (existingWeb && existingWeb !== webKey) {
    return { ok: false, error: 'このLINEの患者さんは、すでに別のホームページの患者さんと紐づいています。' };
  }

  const [lineRecords, webRecords] = await Promise.all([readRecords(lineKey), readRecords(webKey)]);
  const merged = mergeRecords(lineRecords, webRecords);

  await writeRecords(lineKey, merged);
  await redis.del(recordKey(webKey)); // 実体はLINE側に集約するので、web側の重複を消す

  await redis.set(linkKey(webKey), lineKey);
  await redis.set(reverseLinkKey(lineKey), webKey);

  return { ok: true, merged: merged.length };
}

/**
 * 紐づけを解除する
 * 共有していたお薬手帳の内容をホームページ側にコピーしてから外す
 * （患者さんの手元からお薬が消えてしまわないようにするため）
 */
async function unlinkBooks(webKey) {
  const lineKey = await getLinkedLineKey(webKey);
  if (!lineKey) return { ok: false, error: '紐づけられていません。' };

  const shared = await readRecords(lineKey);
  if (shared.length > 0) await writeRecords(webKey, shared);

  await redis.del(linkKey(webKey));
  await redis.del(reverseLinkKey(lineKey));

  return { ok: true };
}

/** 患者さんがLINEで発行する、ホームページと連携するための6桁コード */
async function generateLinkCode(lineKey) {
  const code = crypto.randomInt(100000, 999999).toString();
  await redis.set(linkCodeKey(code), lineKey, 'EX', LINK_CODE_TTL_SECONDS);
  return code;
}

/** コードを照合してLINE側のキーを返す（一度使うと失効する） */
async function resolveLinkCode(code) {
  const key = linkCodeKey(code);
  const lineKey = await redis.get(key);
  if (!lineKey) return null;

  await redis.del(key);
  return lineKey;
}

module.exports = {
  resolveBookKey,
  linkBooks,
  unlinkBooks,
  getLinkedLineKey,
  getLinkedWebKey,
  generateLinkCode,
  resolveLinkCode,
};
