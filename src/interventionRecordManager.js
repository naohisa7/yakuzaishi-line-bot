const crypto = require('crypto');
const redis = require('./redisClient');

/**
 * 患者ごとの対応記録（フォローアップ・残薬調整・有害事象防止など）を管理するモジュール（Redisに永続化）
 * 令和8年度診療報酬改定で新設された各種加算（かかりつけ薬剤師フォローアップ加算等）の
 * 算定サポート用メモとして、いつ・どんな対応をしたかを記録する
 * patientKeyはLINEなら `line:<userId>`、ホームページなら `web:<sessionId>` の形式で渡す
 */

const MAX_ENTRIES = 200;
const RECORD_TTL_SECONDS = 5 * 365 * 24 * 60 * 60; // 5年

function recordKey(patientKey) {
  return `interventions:${patientKey}`;
}

async function getInterventions(patientKey) {
  const raw = await redis.get(recordKey(patientKey));
  if (!raw) return [];

  const list = JSON.parse(raw);
  let migrated = false;
  const withIds = list.map((r) => {
    if (!r.id) {
      migrated = true;
      return { ...r, id: crypto.randomUUID() };
    }
    return r;
  });

  // 編集・削除機能の追加以前に記録された、idを持たない古いデータを移行する
  if (migrated) {
    await redis.set(recordKey(patientKey), JSON.stringify(withIds), 'EX', RECORD_TTL_SECONDS);
  }
  return withIds;
}

async function addIntervention(patientKey, type, note) {
  const list = await getInterventions(patientKey);
  list.unshift({ id: crypto.randomUUID(), type, note, recordedAt: new Date().toISOString() });
  await redis.set(recordKey(patientKey), JSON.stringify(list.slice(0, MAX_ENTRIES)), 'EX', RECORD_TTL_SECONDS);
}

async function updateIntervention(patientKey, id, type, note) {
  const list = await getInterventions(patientKey);
  const item = list.find((r) => r.id === id);
  if (!item) return false;

  item.type = type;
  item.note = note;
  await redis.set(recordKey(patientKey), JSON.stringify(list), 'EX', RECORD_TTL_SECONDS);
  return true;
}

async function removeIntervention(patientKey, id) {
  const list = await getInterventions(patientKey);
  const filtered = list.filter((r) => r.id !== id);
  await redis.set(recordKey(patientKey), JSON.stringify(filtered), 'EX', RECORD_TTL_SECONDS);
}

module.exports = { getInterventions, addIntervention, updateIntervention, removeIntervention };
