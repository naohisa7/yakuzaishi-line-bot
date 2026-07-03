const redis = require('./redisClient');

/**
 * お薬手帳（患者ごとに確認済みの薬を記録）を管理するモジュール（Redisに永続化）
 * patientKeyはLINEなら `line:<userId>`、ホームページなら `web:<sessionId>` の形式で渡す
 */

const MAX_ENTRIES = 30;
const RECORD_TTL_SECONDS = 365 * 24 * 60 * 60; // 1年

function recordKey(patientKey) {
  return `medications:${patientKey}`;
}

async function getMedications(patientKey) {
  const raw = await redis.get(recordKey(patientKey));
  return raw ? JSON.parse(raw) : [];
}

async function addMedication(patientKey, name) {
  const trimmed = name.trim();
  if (!trimmed) return;

  const list = await getMedications(patientKey);
  if (list.some((m) => m.name === trimmed)) return;

  list.unshift({ name: trimmed, recordedAt: new Date().toISOString() });
  await redis.set(recordKey(patientKey), JSON.stringify(list.slice(0, MAX_ENTRIES)), 'EX', RECORD_TTL_SECONDS);
}

async function removeMedication(patientKey, name) {
  const list = await getMedications(patientKey);
  const filtered = list.filter((m) => m.name !== name);
  await redis.set(recordKey(patientKey), JSON.stringify(filtered), 'EX', RECORD_TTL_SECONDS);
}

module.exports = { getMedications, addMedication, removeMedication };
