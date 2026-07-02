const crypto = require('crypto');
const redis = require('./redisClient');

/**
 * 患者さんとご家族・介護者を連携するモジュール（Redisに永続化）
 * 「家族」と「介護者」は別グループとして管理します
 */

const LINK_CODE_TTL_SECONDS = 10 * 60; // 10分

function linkCodeKey(code) {
  return `linkcode:${code}`;
}

function groupKey(patientId, type) {
  return `linked:${type}:${patientId}`;
}

async function generateLinkCode(patientId, type) {
  const code = crypto.randomInt(100000, 999999).toString();
  await redis.set(linkCodeKey(code), JSON.stringify({ patientId, type }), 'EX', LINK_CODE_TTL_SECONDS);
  return code;
}

/**
 * コードを検証し、有効なら { patientId, type } を返す（コードは一度使うと失効）
 */
async function resolveLinkCode(code) {
  const key = linkCodeKey(code);
  const raw = await redis.get(key);
  if (!raw) return null;

  await redis.del(key);
  return JSON.parse(raw);
}

async function linkPerson(patientId, personId, type) {
  await redis.sadd(groupKey(patientId, type), personId);
}

async function getLinkedPeople(patientId, type) {
  return redis.smembers(groupKey(patientId, type));
}

async function getAllLinkedPeople(patientId) {
  const [family, caregiver] = await Promise.all([
    redis.smembers(groupKey(patientId, 'family')),
    redis.smembers(groupKey(patientId, 'caregiver')),
  ]);
  return [...family, ...caregiver];
}

module.exports = {
  generateLinkCode,
  resolveLinkCode,
  linkPerson,
  getLinkedPeople,
  getAllLinkedPeople,
};
