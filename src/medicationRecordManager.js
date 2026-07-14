const redis = require('./redisClient');

/**
 * お薬手帳（患者ごとの服用薬の記録）を管理するモジュール（Redisに永続化）
 * patientKeyはLINEなら `line:<userId>`、ホームページなら `web:<sessionId>` の形式で渡す
 *
 * 各レコードは出所（source）を持つ：
 *   'manual' … 患者さん自身が医薬品マスタから選んで登録したもの（規格まで正確）
 *   'photo'  … 薬・お薬手帳の写真からAIが読み取ったもの
 *   （未設定）… テキストからAIが自動記録していた頃の古いレコード。実際に服用しているか不明で
 *               規格も欠けているため、UIでは「要確認」として扱う（SOURCE_LEGACY）
 */

const MAX_ENTRIES = 30;
const RECORD_TTL_SECONDS = 365 * 24 * 60 * 60; // 1年

const SOURCE_MANUAL = 'manual';
const SOURCE_PHOTO = 'photo';
const SOURCE_LEGACY = 'legacy';

function recordKey(patientKey) {
  return `medications:${patientKey}`;
}

async function save(patientKey, list) {
  await redis.set(recordKey(patientKey), JSON.stringify(list.slice(0, MAX_ENTRIES)), 'EX', RECORD_TTL_SECONDS);
}

async function getMedications(patientKey) {
  const raw = await redis.get(recordKey(patientKey));
  const list = raw ? JSON.parse(raw) : [];
  // sourceを持たない古いレコードは legacy として返す（保存内容はそのまま）
  return list.map((m) => ({ ...m, source: m.source || SOURCE_LEGACY }));
}

/**
 * お薬を1件記録する
 * @param {string} source - SOURCE_MANUAL または SOURCE_PHOTO
 */
async function addMedication(patientKey, name, source = SOURCE_PHOTO) {
  await addMedications(patientKey, [name], source);
}

/**
 * お薬を複数件まとめて記録する（登録画面でまとめて登録するときに使う）
 * @returns {number} 実際に追加された件数（既に登録済みのものは数えない）
 */
async function addMedications(patientKey, names, source = SOURCE_MANUAL) {
  const list = await getMedications(patientKey);
  let added = 0;

  for (const raw of names) {
    const name = (raw || '').trim();
    if (!name) continue;
    if (list.some((m) => m.name === name)) continue;

    list.unshift({ name, source, recordedAt: new Date().toISOString() });
    added++;
  }

  if (added > 0) await save(patientKey, list);
  return added;
}

async function removeMedication(patientKey, name) {
  const list = await getMedications(patientKey);
  await save(patientKey, list.filter((m) => m.name !== name));
}

module.exports = {
  getMedications,
  addMedication,
  addMedications,
  removeMedication,
  SOURCE_MANUAL,
  SOURCE_PHOTO,
  SOURCE_LEGACY,
};
