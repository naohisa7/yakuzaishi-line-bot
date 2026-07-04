const crypto = require('crypto');
const redis = require('./redisClient');

/**
 * ホームページのチャットセッションを管理するモジュール（Redisに永続化）
 */

const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60; // 90日
const WEB_SESSION_SET_KEY = 'web_session_ids';

function sessionKey(id) {
  return `websession:${id}`;
}

async function createSession(patientName) {
  const id = crypto.randomUUID();
  const session = { patientName, consented: false, createdAt: new Date().toISOString() };
  await redis.set(sessionKey(id), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
  await redis.sadd(WEB_SESSION_SET_KEY, id);
  return id;
}

/**
 * これまでに発行した全セッションIDの一覧（薬剤師用チャットコンソールの患者一覧に使う）
 */
async function listSessionIds() {
  return redis.smembers(WEB_SESSION_SET_KEY);
}

/**
 * 期限切れなどで存在しなくなったセッションIDを一覧から取り除く
 */
async function removeSessionId(id) {
  await redis.srem(WEB_SESSION_SET_KEY, id);
}

/**
 * 患者さんの認証を解除する（セッション自体を削除し、次回は名前・認証コードの入力からやり直しになる）
 */
async function deleteSession(id) {
  await redis.del(sessionKey(id));
  await removeSessionId(id);
}

async function getSession(id) {
  const raw = await redis.get(sessionKey(id));
  return raw ? JSON.parse(raw) : null;
}

async function markConsented(id) {
  const session = await getSession(id);
  if (!session) return;
  session.consented = true;
  await redis.set(sessionKey(id), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
}

async function touchSession(id) {
  await redis.expire(sessionKey(id), SESSION_TTL_SECONDS);
}

module.exports = { createSession, getSession, markConsented, touchSession, listSessionIds, removeSessionId, deleteSession };
