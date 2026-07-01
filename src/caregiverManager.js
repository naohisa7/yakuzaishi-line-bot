const crypto = require('crypto');

/**
 * 患者さんとご家族・介護者を連携するモジュール
 * ※本番環境ではRedisやDBへの移行を推奨（再デプロイ・再起動で状態がリセットされます）
 */

const LINK_CODE_TTL_MS = 10 * 60 * 1000; // 10分
const pendingLinkCodes = new Map(); // code -> { patientId, expiresAt }
const caregiversByPatient = new Map(); // patientId -> Set<caregiverId>

function generateLinkCode(patientId) {
  const code = crypto.randomInt(100000, 999999).toString();
  pendingLinkCodes.set(code, { patientId, expiresAt: Date.now() + LINK_CODE_TTL_MS });
  return code;
}

/**
 * コードを検証し、有効なら紐づく患者IDを返す（コードは一度使うと失効）
 */
function resolveLinkCode(code) {
  const entry = pendingLinkCodes.get(code);
  if (!entry) return null;

  pendingLinkCodes.delete(code);
  if (Date.now() > entry.expiresAt) return null;

  return entry.patientId;
}

function linkCaregiver(patientId, caregiverId) {
  if (!caregiversByPatient.has(patientId)) {
    caregiversByPatient.set(patientId, new Set());
  }
  caregiversByPatient.get(patientId).add(caregiverId);
}

function getCaregiversForPatient(patientId) {
  return Array.from(caregiversByPatient.get(patientId) || []);
}

module.exports = { generateLinkCode, resolveLinkCode, linkCaregiver, getCaregiversForPatient };
