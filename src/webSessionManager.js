const crypto = require('crypto');
const redis = require('./redisClient');

/**
 * ホームページのチャットセッションを管理するモジュール（Redisに永続化）
 */

const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60; // 90日

function sessionKey(id) {
  return `websession:${id}`;
}

async function createSession(patientName) {
  const id = crypto.randomUUID();
  const session = { patientName, consented: false, createdAt: new Date().toISOString() };
  await redis.set(sessionKey(id), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
  return id;
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

module.exports = { createSession, getSession, markConsented, touchSession };
