/**
 * 認証済み患者を管理するモジュール
 * ※本番環境ではRedisやDBへの移行を推奨（再デプロイ・再起動で認証状態がリセットされます）
 */

const authorizedUsers = new Set();

function isAuthorized(userId) {
  return authorizedUsers.has(userId);
}

function authorize(userId) {
  authorizedUsers.add(userId);
}

module.exports = { isAuthorized, authorize };
