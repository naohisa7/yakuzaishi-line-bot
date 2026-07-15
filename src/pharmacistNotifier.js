const { getAssignedPharmacistId } = require('./patientAssignmentManager');
const { getPharmacist, listPharmacists } = require('./pharmacistManager');

/**
 * ある患者さんに関する通知（エスカレーション等）を、誰のLINEに送るべきか解決する。
 *
 * - 担当薬剤師がいて、その人がLINE連携済みなら → その1人だけ
 * - 担当が未割り当て／担当がLINE未連携なら → 全アクティブ薬剤師（LINE連携済み）へ
 * - それも居なければ → 環境変数 PHARMACIST_LINE_USER_ID（移行期のフォールバック）
 *
 * 「取りこぼしを出さない」を優先し、担当が捕まらないときは広めに通知する。
 */
async function getNotifyLineIdsForPatient(patientKey) {
  const assignedId = await getAssignedPharmacistId(patientKey);
  if (assignedId) {
    const pharmacist = await getPharmacist(assignedId);
    if (pharmacist && pharmacist.active && pharmacist.lineUserId) {
      return [pharmacist.lineUserId];
    }
  }

  const list = await listPharmacists();
  const ids = list.filter((p) => p.active && p.lineUserId).map((p) => p.lineUserId);
  if (ids.length > 0) return ids;

  const fallback = process.env.PHARMACIST_LINE_USER_ID;
  return fallback ? [fallback] : [];
}

/**
 * 患者さんの担当薬剤師（またはフォールバック先）へ、LINEメッセージをまとめて送る。
 */
async function notifyPharmacistsForPatient(lineClient, patientKey, messages) {
  const recipients = await getNotifyLineIdsForPatient(patientKey);
  for (const lineUserId of recipients) {
    try {
      await lineClient.pushMessage(lineUserId, messages);
    } catch (err) {
      console.error(`薬剤師(${lineUserId})への通知に失敗:`, err.message);
    }
  }
  return recipients.length;
}

module.exports = { getNotifyLineIdsForPatient, notifyPharmacistsForPatient };
