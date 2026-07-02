const redis = require('./redisClient');

/**
 * 「解決しなかった」際のフィードバックを記録・閲覧するモジュール（Redisに永続化）
 */

const FEEDBACK_LOG_KEY = 'feedback_log';
const MAX_LOG_ENTRIES = 500;

async function recordFeedback(patientName, feedbackText) {
  const entry = JSON.stringify({
    patientName,
    feedbackText,
    recordedAt: new Date().toISOString(),
  });
  await redis.lpush(FEEDBACK_LOG_KEY, entry);
  await redis.ltrim(FEEDBACK_LOG_KEY, 0, MAX_LOG_ENTRIES - 1);
}

async function getRecentFeedback(limit = 10) {
  const rawEntries = await redis.lrange(FEEDBACK_LOG_KEY, 0, limit - 1);
  return rawEntries.map((raw) => JSON.parse(raw));
}

module.exports = { recordFeedback, getRecentFeedback };
