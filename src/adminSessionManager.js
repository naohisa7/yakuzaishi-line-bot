const crypto = require('crypto');
const redis = require('./redisClient');

/**
 * ホームページの管理者ページ（記事の追加・編集・削除）用セッションを管理するモジュール（Redisに永続化）
 */

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7日

function sessionKey(id) {
  return `adminsession:${id}`;
}

async function createAdminSession() {
  const id = crypto.randomUUID();
  await redis.set(sessionKey(id), '1', 'EX', SESSION_TTL_SECONDS);
  return id;
}

async function isValidAdminSession(id) {
  if (!id) return false;
  const exists = await redis.get(sessionKey(id));
  return !!exists;
}

module.exports = { createAdminSession, isValidAdminSession };
