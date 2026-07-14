const redis = require('./redisClient');

/**
 * LINEでのお薬手帳登録セッションを管理するモジュール（Redisに永続化）
 *
 * LINEには画面が無いため、ホームページの登録画面と同じ「検索 → 候補から選ぶ →
 * 繰り返す → まとめて登録」の流れを、会話の状態として持ち回る必要がある。
 *
 * セッションの中身：
 *   targetKey           … 登録先のお薬手帳（line:<userId> または web:<sessionId>）
 *   targetName          … 表示用の名前
 *   source              … 'manual'（患者さん自身）/ 'pharmacist'（薬剤師）
 *   includeManufacturer … 候補にメーカー名を含めるか（薬剤師のみtrue）
 *   pending             … 登録予定のお薬（まだ保存していない）
 *   candidates          … 直近の検索候補（番号やボタンで選ぶために保持する）
 *
 * 途中で放置されたセッションが残り続けないようTTLを付ける。
 */

const SESSION_TTL_SECONDS = 30 * 60; // 30分

function sessionKey(lineUserId) {
  return `medentry:${lineUserId}`;
}

async function getEntry(lineUserId) {
  const raw = await redis.get(sessionKey(lineUserId));
  return raw ? JSON.parse(raw) : null;
}

async function saveEntry(lineUserId, session) {
  await redis.set(sessionKey(lineUserId), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
}

/**
 * 登録セッションを開始する
 * @param {string} lineUserId - 操作している人のLINE userId
 * @param {{targetKey: string, targetName: string, source: string, includeManufacturer: boolean}} target
 */
async function startEntry(lineUserId, target) {
  const session = {
    targetKey: target.targetKey,
    targetName: target.targetName,
    source: target.source,
    includeManufacturer: !!target.includeManufacturer,
    pending: [],
    candidates: [],
  };
  await saveEntry(lineUserId, session);
  return session;
}

/** 直近の検索候補を差し替える（選択時に番号から名前を引けるようにするため） */
async function setCandidates(lineUserId, session, candidates) {
  session.candidates = candidates;
  await saveEntry(lineUserId, session);
  return session;
}

/**
 * 候補を登録予定リストに積む
 * @returns {{ session: object, name: string|null, duplicated: boolean }}
 */
async function addPending(lineUserId, session, index) {
  const name = session.candidates[index];
  if (!name) return { session, name: null, duplicated: false };

  if (session.pending.includes(name)) {
    return { session, name, duplicated: true };
  }

  session.pending.push(name);
  session.candidates = []; // 選んだら候補は閉じ、次の検索に備える
  await saveEntry(lineUserId, session);
  return { session, name, duplicated: false };
}

/**
 * 複数のお薬をまとめて登録予定リストに積む（写真から読み取ったときに使う）
 * すでに入っているお薬は重複して積まない
 */
async function appendPending(lineUserId, session, names) {
  for (const raw of names) {
    const name = (raw || '').trim();
    if (!name || session.pending.includes(name)) continue;
    session.pending.push(name);
  }

  session.candidates = []; // 写真から積んだら、直前の検索候補は閉じる
  await saveEntry(lineUserId, session);
  return session;
}

/** 登録予定リストから1件取り消す */
async function removePending(lineUserId, session, index) {
  const name = session.pending[index];
  if (!name) return { session, name: null };

  session.pending.splice(index, 1);
  await saveEntry(lineUserId, session);
  return { session, name };
}

async function clearEntry(lineUserId) {
  await redis.del(sessionKey(lineUserId));
}

module.exports = {
  getEntry,
  startEntry,
  setCandidates,
  addPending,
  appendPending,
  removePending,
  clearEntry,
};
