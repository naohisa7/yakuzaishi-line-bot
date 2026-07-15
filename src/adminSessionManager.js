const crypto = require('crypto');
const redis = require('./redisClient');

/**
 * 薬剤師専用ページ（/console・/admin など）のログインセッションを管理するモジュール（Redisに永続化）
 * セッションには、どの薬剤師としてログインしているか（pharmacistId）を保持する。
 */

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7日

function sessionKey(id) {
  return `adminsession:${id}`;
}

async function createAdminSession(pharmacistId = null) {
  const id = crypto.randomUUID();
  await redis.set(sessionKey(id), JSON.stringify({ pharmacistId }), 'EX', SESSION_TTL_SECONDS);
  return id;
}

async function isValidAdminSession(id) {
  if (!id) return false;
  const exists = await redis.get(sessionKey(id));
  return !!exists;
}

/**
 * ログイン中の薬剤師IDを返す（旧形式の値 '1' 等は pharmacistId を持たないので null）
 */
async function getSessionPharmacistId(id) {
  if (!id) return null;
  const raw = await redis.get(sessionKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw).pharmacistId || null;
  } catch {
    return null;
  }
}

module.exports = { createAdminSession, isValidAdminSession, getSessionPharmacistId };
