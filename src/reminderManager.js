const crypto = require('crypto');
const redis = require('./redisClient');

/**
 * 患者ごとの服薬リマインダー設定を管理するモジュール（Redisに永続化）
 * 薬剤師が /console から患者ごとに時刻・メッセージを設定し（回数の上限なし）、
 * 外部cronサービスから叩かれる /api/cron/medication-reminders が各時刻ごとに1日1回送信する
 * patientKeyはLINEなら `line:<userId>`、ホームページなら `web:<sessionId>` の形式
 */

const REMINDER_SET_KEY = 'reminder_patient_keys';

function reminderKey(patientKey) {
  return `reminder:${patientKey}`;
}

async function getReminders(patientKey) {
  const raw = await redis.get(reminderKey(patientKey));
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;

  // 旧形式（患者につき1件のみのオブジェクト）で保存されたデータを新形式に自動移行する
  const migrated = parsed && parsed.time
    ? [{ id: crypto.randomUUID(), time: parsed.time, message: parsed.message || '', lastSentDate: parsed.lastSentDate || null }]
    : [];
  await redis.set(reminderKey(patientKey), JSON.stringify(migrated));
  return migrated;
}

async function addReminder(patientKey, time, message) {
  const list = await getReminders(patientKey);
  list.push({ id: crypto.randomUUID(), time, message, lastSentDate: null });
  await redis.sadd(REMINDER_SET_KEY, patientKey);
  await redis.set(reminderKey(patientKey), JSON.stringify(list));
}

async function removeReminder(patientKey, id) {
  const list = await getReminders(patientKey);
  const filtered = list.filter((r) => r.id !== id);

  if (filtered.length === 0) {
    await redis.srem(REMINDER_SET_KEY, patientKey);
    await redis.del(reminderKey(patientKey));
  } else {
    await redis.set(reminderKey(patientKey), JSON.stringify(filtered));
  }
}

async function listReminderPatientKeys() {
  return redis.smembers(REMINDER_SET_KEY);
}

async function markSent(patientKey, id, dateStr) {
  const list = await getReminders(patientKey);
  const item = list.find((r) => r.id === id);
  if (!item) return;
  item.lastSentDate = dateStr;
  await redis.set(reminderKey(patientKey), JSON.stringify(list));
}

module.exports = {
  getReminders,
  addReminder,
  removeReminder,
  listReminderPatientKeys,
  markSent,
};
