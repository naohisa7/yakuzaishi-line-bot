/**
 * 患者ごとの会話履歴を管理するモジュール
 * ※本番環境ではRedisやDBへの移行を推奨
 */

const MAX_HISTORY = 10; // 保持するメッセージ数（古いものから削除）
const conversationStore = new Map();

/**
 * 会話履歴にメッセージを追加
 */
function addMessage(userId, role, content) {
  if (!conversationStore.has(userId)) {
    conversationStore.set(userId, []);
  }

  const history = conversationStore.get(userId);
  history.push({ role, content });

  // 最大件数を超えたら古いものを削除（最初の1件は文脈保持のため残す）
  if (history.length > MAX_HISTORY) {
    history.splice(1, history.length - MAX_HISTORY);
  }
}

/**
 * 会話履歴を取得
 */
function getHistory(userId) {
  return conversationStore.get(userId) || [];
}

/**
 * 会話履歴をリセット（「リセット」コマンドなどで使用）
 */
function clearHistory(userId) {
  conversationStore.delete(userId);
}

module.exports = { addMessage, getHistory, clearHistory };
