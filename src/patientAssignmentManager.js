const redis = require('./redisClient');
const { resolveBookKey } = require('./medicationBookLinkManager');

/**
 * 患者さんと担当薬剤師の紐づけを管理するモジュール（Redisに永続化）
 *
 * 患者さんが薬剤師の認証コードで認証した時点で、その薬剤師が担当になる。
 * お薬手帳と同じく、LINE⇔HPが紐づいている患者さんは1つの担当を共有するため、
 * 入口で resolveBookKey() を通して「正となるキー」に解決してから読み書きする。
 * （解決を通さずに直接読み書きすると同期が壊れるので注意）
 */

function assignmentKey(patientKey) {
  return `patient_pharmacist:${patientKey}`;
}

async function getAssignedPharmacistId(patientKey) {
  const key = await resolveBookKey(patientKey);
  return redis.get(assignmentKey(key));
}

async function assignPharmacist(patientKey, pharmacistId) {
  if (!pharmacistId) return;
  const key = await resolveBookKey(patientKey);
  await redis.set(assignmentKey(key), pharmacistId);
}

async function unassign(patientKey) {
  const key = await resolveBookKey(patientKey);
  await redis.del(assignmentKey(key));
}

module.exports = {
  getAssignedPharmacistId,
  assignPharmacist,
  unassign,
};
