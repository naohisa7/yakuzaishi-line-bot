/**
 * 薬剤師がチャットで患者さんに返信する際の「返信モード」を管理するモジュール
 */

const pendingReplyTarget = new Map(); // pharmacistId -> patientId

function startReply(pharmacistId, patientId) {
  pendingReplyTarget.set(pharmacistId, patientId);
}

function getReplyTarget(pharmacistId) {
  return pendingReplyTarget.get(pharmacistId);
}

function clearReply(pharmacistId) {
  pendingReplyTarget.delete(pharmacistId);
}

module.exports = { startReply, getReplyTarget, clearReply };
