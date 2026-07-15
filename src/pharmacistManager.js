const crypto = require('crypto');
const redis = require('./redisClient');

/**
 * かかりつけ薬剤師の名簿を管理するモジュール（Redisに永続化）
 *
 * 薬剤師は複数名（4名想定）。各薬剤師は以下を持つ：
 *   - name             … 表示名
 *   - patientAuthCode  … 患者さん向けの認証コード（薬剤師ごとに一意）。患者さんがこのコードで
 *                        認証すると、その薬剤師が「担当」になる（patientAssignmentManager）
 *   - passwordHash     … /console 等へのログイン用パスワードのハッシュ（scrypt・平文は保存しない）
 *   - lineUserId       … その薬剤師本人のLINE userId（エスカレーション通知・LINE管理機能の宛先）
 *   - active           … 有効フラグ
 *
 * 実際のパスワード・認証コード・LINE連携は、所有者がLINEの管理コマンドで設定する。
 */

const PHARMACIST_IDS_KEY = 'pharmacist_ids';
const SEEDED_KEY = 'pharmacists_seeded_v1';

function pharmacistKey(id) {
  return `pharmacist:${id}`;
}

// 認証コードから薬剤師IDを逆引きするためのキー（コードは薬剤師間で一意）
function authCodeKey(code) {
  return `pharmacist_authcode:${code}`;
}

// ── パスワードのハッシュ化（scrypt＋ランダムsalt。平文は保存しない）──
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyHash(plain, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  let calc;
  try {
    calc = crypto.scryptSync(plain, salt, 64).toString('hex');
  } catch {
    return false;
  }
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(calc, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function getPharmacist(id) {
  if (!id) return null;
  const raw = await redis.get(pharmacistKey(id));
  return raw ? JSON.parse(raw) : null;
}

async function listPharmacists() {
  const ids = await redis.lrange(PHARMACIST_IDS_KEY, 0, -1);
  const list = await Promise.all(ids.map((id) => getPharmacist(id)));
  return list.filter(Boolean);
}

async function savePharmacist(p) {
  await redis.set(pharmacistKey(p.id), JSON.stringify(p));
  return p;
}

async function addPharmacist(name) {
  const id = crypto.randomUUID();
  const pharmacist = {
    id,
    name,
    patientAuthCode: null,
    passwordHash: null,
    lineUserId: null,
    active: true,
    createdAt: new Date().toISOString(),
  };
  await redis.set(pharmacistKey(id), JSON.stringify(pharmacist));
  await redis.rpush(PHARMACIST_IDS_KEY, id);
  return pharmacist;
}

async function updatePharmacist(id, patch) {
  const pharmacist = await getPharmacist(id);
  if (!pharmacist) return null;
  return savePharmacist({ ...pharmacist, ...patch });
}

async function getPharmacistByLineUserId(lineUserId) {
  if (!lineUserId) return null;
  const list = await listPharmacists();
  return list.find((p) => p.active && p.lineUserId === lineUserId) || null;
}

/**
 * 患者さんが入力した認証コードから、担当となる薬剤師を解決する。
 * どの薬剤師のコードにも一致しなければ null（＝認証失敗）。
 */
async function getPharmacistByAuthCode(code) {
  if (!code) return null;
  const id = await redis.get(authCodeKey(code));
  if (!id) return null;
  const pharmacist = await getPharmacist(id);
  return pharmacist && pharmacist.active ? pharmacist : null;
}

/**
 * 患者向け認証コードを設定する（仮コード→実コードの確定もこれ）。
 * コードは薬剤師間で一意。既に他の薬剤師が使っているコードは弾く。
 */
async function setAuthCode(id, code) {
  const pharmacist = await getPharmacist(id);
  if (!pharmacist) return { ok: false, message: '該当の薬剤師が見つかりません。' };

  const owner = await redis.get(authCodeKey(code));
  if (owner && owner !== id) {
    return { ok: false, message: 'その認証コードは既に他の薬剤師が使用しています。別のコードにしてください。' };
  }

  // 古いコードの逆引きを消してから新しいコードを張る
  if (pharmacist.patientAuthCode && pharmacist.patientAuthCode !== code) {
    await redis.del(authCodeKey(pharmacist.patientAuthCode));
  }
  await redis.set(authCodeKey(code), id);
  await savePharmacist({ ...pharmacist, patientAuthCode: code });
  return { ok: true };
}

async function setPassword(id, plain) {
  const pharmacist = await getPharmacist(id);
  if (!pharmacist) return false;
  await savePharmacist({ ...pharmacist, passwordHash: hashPassword(plain) });
  return true;
}

async function verifyPassword(id, plain) {
  const pharmacist = await getPharmacist(id);
  if (!pharmacist || !pharmacist.active || !pharmacist.passwordHash) return false;
  return verifyHash(plain, pharmacist.passwordHash);
}

async function removePharmacist(id) {
  const pharmacist = await getPharmacist(id);
  if (!pharmacist) return;
  if (pharmacist.patientAuthCode) await redis.del(authCodeKey(pharmacist.patientAuthCode));
  await redis.del(pharmacistKey(id));
  await redis.lrem(PHARMACIST_IDS_KEY, 0, id);
}

/**
 * 起動時に一度だけ、既存の単一薬剤師設定から薬剤師#1を作成する（冪等）。
 *
 * 既存の pharmacist_name（表示名）・PHARMACIST_LINE_USER_ID（LINE連携）・
 * patient_passcode（患者認証コード）・admin_passcode（ログインパスワード）を引き継ぐので、
 * これまでの動作を壊さずに多人数対応へ移行できる。残り3名は所有者がLINEコマンドで追加する。
 * Redis未接続などで失敗した場合はフラグを立てず、次回起動時に再試行する。
 */
async function seedPharmacists() {
  try {
    if (await redis.get(SEEDED_KEY)) return;

    const existing = await listPharmacists();
    if (existing.length === 0) {
      // 循環参照を避けるため関数内で読み込む
      const { getPasscode } = require('./passcodeManager');
      const { getAdminPasscode } = require('./adminPasscodeManager');
      const { getPharmacistName } = require('./contentManager');

      const name = (await getPharmacistName()) || '担当薬剤師';
      const pharmacist = await addPharmacist(name);

      const lineUserId = process.env.PHARMACIST_LINE_USER_ID || null;
      if (lineUserId) await updatePharmacist(pharmacist.id, { lineUserId });

      const code = await getPasscode();
      if (code) await setAuthCode(pharmacist.id, code);

      const password = await getAdminPasscode();
      if (password) await setPassword(pharmacist.id, password);

      console.log('👥 既存設定から薬剤師#1を作成しました');
    }

    await redis.set(SEEDED_KEY, '1');
  } catch (err) {
    console.error('薬剤師名簿の初期化に失敗しました（次回起動時に再試行します）:', err.message);
  }
}

module.exports = {
  listPharmacists,
  getPharmacist,
  getPharmacistByLineUserId,
  getPharmacistByAuthCode,
  addPharmacist,
  updatePharmacist,
  setAuthCode,
  setPassword,
  verifyPassword,
  removePharmacist,
  seedPharmacists,
};
