/**
 * プライバシーポリシーへの同意待ち状態を管理するモジュール
 * ※本番環境ではRedisやDBへの移行を推奨（再デプロイ・再起動で状態がリセットされます）
 */

const pendingConsent = new Set();

function markPendingConsent(userId) {
  pendingConsent.add(userId);
}

function isPendingConsent(userId) {
  return pendingConsent.has(userId);
}

function clearPendingConsent(userId) {
  pendingConsent.delete(userId);
}

module.exports = { markPendingConsent, isPendingConsent, clearPendingConsent };
