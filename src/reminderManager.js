const redis = require('./redisClient');

/**
 * 患者ごとの服薬リマインダー設定を管理するモジュール（Redisに永続化）
 * 薬剤師が /console から患者ごとに時刻・メッセージを設定し、
 * 外部cronサービスから叩かれる /api/cron/medication-reminders が1日1回送信する
 * patientKeyはLINEなら `line:<userId>`、ホームページなら `web:<sessionId>` の形式
 */

const REMINDER_SET_KEY = 'reminder_patient_keys';

function reminderKey(patientKey) {
  return `reminder:${patientKey}`;
}

async function getReminder(patientKey) {
  const raw = await redis.get(reminderKey(patientKey));
  return raw ? JSON.parse(raw) : null;
}

async function setReminder(patientKey, time, message) {
  const existing = await getReminder(patientKey);
  const data = { time, message, lastSentDate: existing ? existing.lastSentDate : null };
  await redis.sadd(REMINDER_SET_KEY, patientKey);
  await redis.set(reminderKey(patientKey), JSON.stringify(data));
}

async function clearReminder(patientKey) {
  await redis.srem(REMINDER_SET_KEY, patientKey);
  await redis.del(reminderKey(patientKey));
}

async function listReminderPatientKeys() {
  return redis.smembers(REMINDER_SET_KEY);
}

async function markSent(patientKey, dateStr) {
  const existing = await getReminder(patientKey);
  if (!existing) return;
  existing.lastSentDate = dateStr;
  await redis.set(reminderKey(patientKey), JSON.stringify(existing));
}

module.exports = { getReminder, setReminder, clearReminder, listReminderPatientKeys, markSent };
