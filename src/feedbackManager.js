/**
 * 「解決しなかった」を選んだ患者さんからの詳細フィードバック待ち状態を管理するモジュール
 * ※本番環境ではRedisやDBへの移行を推奨（再デプロイ・再起動で状態がリセットされます）
 */

const awaitingFeedback = new Set();

function markAwaitingFeedback(userId) {
  awaitingFeedback.add(userId);
}

function isAwaitingFeedback(userId) {
  return awaitingFeedback.has(userId);
}

function clearAwaitingFeedback(userId) {
  awaitingFeedback.delete(userId);
}

module.exports = { markAwaitingFeedback, isAwaitingFeedback, clearAwaitingFeedback };
