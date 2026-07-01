const crypto = require('crypto');

/**
 * 患者さんとご家族・介護者を連携するモジュール
 * 「家族」と「介護者」は別グループとして管理します
 * ※本番環境ではRedisやDBへの移行を推奨（再デプロイ・再起動で状態がリセットされます）
 */

const LINK_CODE_TTL_MS = 10 * 60 * 1000; // 10分
const pendingLinkCodes = new Map(); // code -> { patientId, type, expiresAt }
const linkedByPatient = new Map(); // patientId -> { family: Set, caregiver: Set }

function getGroups(patientId) {
  if (!linkedByPatient.has(patientId)) {
    linkedByPatient.set(patientId, { family: new Set(), caregiver: new Set() });
  }
  return linkedByPatient.get(patientId);
}

function generateLinkCode(patientId, type) {
  const code = crypto.randomInt(100000, 999999).toString();
  pendingLinkCodes.set(code, { patientId, type, expiresAt: Date.now() + LINK_CODE_TTL_MS });
  return code;
}

/**
 * コードを検証し、有効なら { patientId, type } を返す（コードは一度使うと失効）
 */
function resolveLinkCode(code) {
  const entry = pendingLinkCodes.get(code);
  if (!entry) return null;

  pendingLinkCodes.delete(code);
  if (Date.now() > entry.expiresAt) return null;

  return entry;
}

function linkPerson(patientId, personId, type) {
  getGroups(patientId)[type].add(personId);
}

function getLinkedPeople(patientId, type) {
  return Array.from(getGroups(patientId)[type]);
}

function getAllLinkedPeople(patientId) {
  const groups = getGroups(patientId);
  return [...groups.family, ...groups.caregiver];
}

module.exports = {
  generateLinkCode,
  resolveLinkCode,
  linkPerson,
  getLinkedPeople,
  getAllLinkedPeople,
};
