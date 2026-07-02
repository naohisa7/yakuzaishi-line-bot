const redis = require('./redisClient');

/**
 * ホームページチャットへのリアルタイム配信を管理するモジュール
 * 接続中はWebSocketで即時配信、未接続時はRedisに保留して次回読み込み時に配信する
 */

const sockets = new Map(); // sessionId -> WebSocket
const PENDING_TTL_SECONDS = 30 * 24 * 60 * 60; // 30日

function pendingKey(sessionId) {
  return `webpending:${sessionId}`;
}

function registerSocket(sessionId, ws) {
  sockets.set(sessionId, ws);
}

function unregisterSocket(sessionId, ws) {
  if (sockets.get(sessionId) === ws) {
    sockets.delete(sessionId);
  }
}

async function sendToSession(sessionId, payload) {
  const ws = sockets.get(sessionId);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
    return;
  }

  await redis.rpush(pendingKey(sessionId), JSON.stringify(payload));
  await redis.expire(pendingKey(sessionId), PENDING_TTL_SECONDS);
}

async function popPendingMessages(sessionId) {
  const key = pendingKey(sessionId);
  const raw = await redis.lrange(key, 0, -1);
  await redis.del(key);
  return raw.map((entry) => JSON.parse(entry));
}

module.exports = { registerSocket, unregisterSocket, sendToSession, popPendingMessages };
