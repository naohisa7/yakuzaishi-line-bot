const redis = require('./redisClient');

/**
 * ホームページチャットの会話履歴を管理するモジュール（Redisに永続化）
 * LINEのconversationManager.jsと同じ挙動（最大件数・最初の1件は保持）をWebセッション向けに提供
 */

const MAX_HISTORY = 10;
const HISTORY_TTL_SECONDS = 90 * 24 * 60 * 60; // 90日

function historyKey(sessionId) {
  return `webconv:${sessionId}`;
}

async function addMessage(sessionId, role, content) {
  const history = await getHistory(sessionId);
  history.push({ role, content });

  if (history.length > MAX_HISTORY) {
    history.splice(1, history.length - MAX_HISTORY);
  }

  await redis.set(historyKey(sessionId), JSON.stringify(history), 'EX', HISTORY_TTL_SECONDS);
}

async function getHistory(sessionId) {
  const raw = await redis.get(historyKey(sessionId));
  return raw ? JSON.parse(raw) : [];
}

async function clearHistory(sessionId) {
  await redis.del(historyKey(sessionId));
}

module.exports = { addMessage, getHistory, clearHistory };
