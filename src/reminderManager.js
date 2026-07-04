const crypto = require('crypto');
const redis = require('./redisClient');

/**
 * 患者ごとの服薬リマインダー設定を管理するモジュール（Redisに永続化）
 * 薬剤師が /console から患者ごとに時刻・メッセージを設定し（1日最大3回まで）、
 * 外部cronサービスから叩かれる /api/cron/medication-reminders が各時刻ごとに1日1回送信する
 * patientKeyはLINEなら `line:<userId>`、ホームページなら `web:<sessionId>` の形式
 */

const REMINDER_SET_KEY = 'reminder_patient_keys';
const MAX_REMINDERS_PER_PATIENT = 3;

function reminderKey(patientKey) {
  return `reminder:${patientKey}`;
}

async function getReminders(patientKey) {
  const raw = await redis.get(reminderKey(patientKey));
  return raw ? JSON.parse(raw) : [];
}

async function addReminder(patientKey, time, message) {
  const list = await getReminders(patientKey);
  if (list.length >= MAX_REMINDERS_PER_PATIENT) {
    throw new Error(`1日${MAX_REMINDERS_PER_PATIENT}回までしか設定できません。`);
  }

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
  MAX_REMINDERS_PER_PATIENT,
};
