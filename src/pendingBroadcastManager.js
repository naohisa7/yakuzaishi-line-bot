/**
 * 薬剤師が一斉送信の内容を確認するまでの一時的な保留状態を管理するモジュール
 */

const pendingBroadcast = new Map(); // pharmacistId -> text

function setPendingBroadcast(pharmacistId, text) {
  pendingBroadcast.set(pharmacistId, text);
}

function getPendingBroadcast(pharmacistId) {
  return pendingBroadcast.get(pharmacistId);
}

function clearPendingBroadcast(pharmacistId) {
  pendingBroadcast.delete(pharmacistId);
}

module.exports = { setPendingBroadcast, getPendingBroadcast, clearPendingBroadcast };
