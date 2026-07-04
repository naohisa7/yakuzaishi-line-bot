const redis = require('./redisClient');

/**
 * 患者ごとの対応記録（フォローアップ・残薬調整・有害事象防止など）を管理するモジュール（Redisに永続化）
 * 令和8年度診療報酬改定で新設された各種加算（かかりつけ薬剤師フォローアップ加算等）の
 * 算定サポート用メモとして、いつ・どんな対応をしたかを記録する
 * patientKeyはLINEなら `line:<userId>`、ホームページなら `web:<sessionId>` の形式で渡す
 */

const MAX_ENTRIES = 50;
const RECORD_TTL_SECONDS = 365 * 24 * 60 * 60; // 1年

function recordKey(patientKey) {
  return `interventions:${patientKey}`;
}

async function getInterventions(patientKey) {
  const raw = await redis.get(recordKey(patientKey));
  return raw ? JSON.parse(raw) : [];
}

async function addIntervention(patientKey, type, note) {
  const list = await getInterventions(patientKey);
  list.unshift({ type, note, recordedAt: new Date().toISOString() });
  await redis.set(recordKey(patientKey), JSON.stringify(list.slice(0, MAX_ENTRIES)), 'EX', RECORD_TTL_SECONDS);
}

module.exports = { getInterventions, addIntervention };
