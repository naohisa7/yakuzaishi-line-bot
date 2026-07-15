/**
 * プライバシーポリシーへの同意待ち状態を管理するモジュール
 * ※本番環境ではRedisやDBへの移行を推奨（再デプロイ・再起動で状態がリセットされます）
 *
 * 認証コードで認証した薬剤師（担当）を、同意成立まで一時的に保持する。
 * 値は { pharmacistId } を持つ（担当を紐づけない旧経路では null でもよい）。
 */

const pendingConsent = new Map();

function markPendingConsent(userId, data = null) {
  pendingConsent.set(userId, data);
}

function isPendingConsent(userId) {
  return pendingConsent.has(userId);
}

function getPendingConsent(userId) {
  return pendingConsent.get(userId) || null;
}

function clearPendingConsent(userId) {
  pendingConsent.delete(userId);
}

module.exports = { markPendingConsent, isPendingConsent, getPendingConsent, clearPendingConsent };
