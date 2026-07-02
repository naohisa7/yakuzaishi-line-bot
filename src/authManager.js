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

module.exports = { isAuthorized, authorize, getAuthorizedUsers };
