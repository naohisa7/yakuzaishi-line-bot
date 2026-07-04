const redis = require('./redisClient');

/**
 * 認証済み患者を管理するモジュール（Redisに永続化）
 */

const AUTH_SET_KEY = 'authorized_users';

async function isAuthorized(userId) {
  return (await redis.sismember(AUTH_SET_KEY, userId)) === 1;
}

async function authorize(userId) {
  await redis.sadd(AUTH_SET_KEY, userId);
}

async function getAuthorizedUsers() {
  return redis.smembers(AUTH_SET_KEY);
}

/**
 * 患者さんの認証を解除する（次回利用時は認証コードの入力からやり直しになる）
 */
async function revoke(userId) {
  await redis.srem(AUTH_SET_KEY, userId);
}

module.exports = { isAuthorized, authorize, getAuthorizedUsers, revoke };
