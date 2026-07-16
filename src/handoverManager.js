const redis = require('./redisClient');

/**
 * 「薬剤師対応中」（AI一時停止）の状態を管理するモジュール（Redisに永続化）
 *
 * エスカレーション後に薬剤師が返信して対応を引き取ったのに、その後の患者さんの発言に
 * AIが割り込んで答えてしまうのを防ぐ。薬剤師が返信した時点で対応中になり、その間は
 * AIは応答せず、患者さんの発言は担当薬剤師へ転送される。
 *
 * 自動再開はRedisのTTLで実現する（薬剤師が「対応終了」を押し忘れても、一定時間で
 * 自動的にAI応答が戻るので、患者さんが無応答のまま放置されない）。
 * 薬剤師が返信するたびに touch でTTLを延長する。
 *
 * patientKey は会話の窓口ごと（line:<userId> / web:<sessionId>）。会話履歴と同じく
 * 窓口単位で扱うので、お薬手帳のような resolveBookKey は通さない。
 */

const HANDOVER_TTL_SECONDS = 3 * 60 * 60; // 3時間（薬剤師の返信ごとに延長）

function handoverKey(patientKey) {
  return `handover:${patientKey}`;
}

/**
 * 薬剤師が対応を引き取る（AIを止める）。返信のたびに呼んでTTLを延長する。
 */
async function startHandover(patientKey, { pharmacistId = null, pharmacistName = null } = {}) {
  const existing = await getHandover(patientKey);
  const state = {
    pharmacistId,
    pharmacistName,
    startedAt: existing ? existing.startedAt : new Date().toISOString(),
    // 患者さんへの「お伝えしました」案内を出したかどうか（毎回は出さない）
    acked: existing ? !!existing.acked : false,
  };
  await redis.set(handoverKey(patientKey), JSON.stringify(state), 'EX', HANDOVER_TTL_SECONDS);
  return state;
}

async function getHandover(patientKey) {
  const raw = await redis.get(handoverKey(patientKey));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function isHandoverActive(patientKey) {
  return !!(await getHandover(patientKey));
}

/**
 * 患者さんへの案内を出した印を付ける（残りTTLは維持する）
 */
async function markAcked(patientKey) {
  const state = await getHandover(patientKey);
  if (!state) return;
  const ttl = await redis.ttl(handoverKey(patientKey));
  state.acked = true;
  await redis.set(
    handoverKey(patientKey),
    JSON.stringify(state),
    'EX',
    ttl && ttl > 0 ? ttl : HANDOVER_TTL_SECONDS
  );
}

/**
 * 対応終了（AI応答を再開する）
 */
async function endHandover(patientKey) {
  await redis.del(handoverKey(patientKey));
}

module.exports = {
  startHandover,
  getHandover,
  isHandoverActive,
  markAcked,
  endHandover,
  HANDOVER_TTL_SECONDS,
};
