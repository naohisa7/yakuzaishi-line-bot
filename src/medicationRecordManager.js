const redis = require('./redisClient');

/**
 * お薬手帳（患者ごとの服用薬の記録）を管理するモジュール（Redisに永続化）
 * patientKeyはLINEなら `line:<userId>`、ホームページなら `web:<sessionId>` の形式で渡す
 *
 * 各レコードは出所（source）を持ち、「薬剤師が作成したお薬手帳」と
 * 「患者さんが作成したお薬手帳」を分けて扱うために使う：
 *   'pharmacist' … 担当薬剤師が/consoleから登録したもの。患者さんからは削除できない
 *   'manual'     … 患者さん自身が医薬品マスタから選んで登録したもの（規格まで正確）
 *   'photo'      … 薬・お薬手帳の写真からAIが読み取ったもの
 *   （未設定）   … テキストからAIが自動記録していた頃の古いレコード。実際に服用しているか不明で
 *                  規格も欠けているため、UIでは「要確認」として扱う（SOURCE_LEGACY）
 *
 * 'pharmacist' 以外はすべて患者さん側のお薬手帳として扱う（isPharmacistSource参照）
 */

const MAX_ENTRIES = 60; // 薬剤師側・患者さん側の2冊分を保持する
const RECORD_TTL_SECONDS = 365 * 24 * 60 * 60; // 1年

const SOURCE_PHARMACIST = 'pharmacist';
const SOURCE_MANUAL = 'manual';
const SOURCE_PHOTO = 'photo';
const SOURCE_LEGACY = 'legacy';

/** そのレコードが「薬剤師が作成したお薬手帳」に属するか */
function isPharmacistSource(source) {
  return source === SOURCE_PHARMACIST;
}

function recordKey(patientKey) {
  return `medications:${patientKey}`;
}

async function save(patientKey, list) {
  await redis.set(recordKey(patientKey), JSON.stringify(list.slice(0, MAX_ENTRIES)), 'EX', RECORD_TTL_SECONDS);
}

async function getMedications(patientKey) {
  const raw = await redis.get(recordKey(patientKey));
  const list = raw ? JSON.parse(raw) : [];
  // sourceを持たない古いレコードは legacy として返す（保存内容はそのまま）
  return list.map((m) => ({ ...m, source: m.source || SOURCE_LEGACY }));
}

/**
 * お薬を1件記録する
 * @param {string} source - SOURCE_PHARMACIST / SOURCE_MANUAL / SOURCE_PHOTO
 */
async function addMedication(patientKey, name, source = SOURCE_PHOTO) {
  return addMedications(patientKey, [name], source);
}

/**
 * お薬を複数件まとめて記録する（登録画面でまとめて登録するときに使う）
 *
 * 重複判定は「同じお薬手帳の中で」行う。薬剤師と患者さんが同じお薬を登録することは
 * ありうるが、2冊は別々の手帳なので、片方に既にあっても、もう片方には登録できる。
 *
 * @returns {number} 実際に追加された件数（同じ手帳に登録済みのものは数えない）
 */
async function addMedications(patientKey, names, source = SOURCE_MANUAL) {
  const list = await getMedications(patientKey);
  const targetIsPharmacist = isPharmacistSource(source);
  let added = 0;

  for (const raw of names) {
    const name = (raw || '').trim();
    if (!name) continue;

    const alreadyInSameBook = list.some(
      (m) => m.name === name && isPharmacistSource(m.source) === targetIsPharmacist
    );
    if (alreadyInSameBook) continue;

    list.unshift({ name, source, recordedAt: new Date().toISOString() });
    added++;
  }

  if (added > 0) await save(patientKey, list);
  return added;
}

/**
 * お薬を削除する
 *
 * @param {'patient'|'pharmacist'} scope - どちらのお薬手帳から消すか。
 *   'patient'    … 患者さんによる削除。薬剤師が登録したお薬は消せない
 *   'pharmacist' … 薬剤師による削除。薬剤師が登録したお薬だけを消せる
 *   互いの手帳を消せないよう、呼び出し側の権限に応じて必ず指定すること
 * @returns {boolean} 実際に削除できたか
 */
async function removeMedication(patientKey, name, scope) {
  const list = await getMedications(patientKey);
  const removingPharmacistEntry = scope === 'pharmacist';

  const remaining = list.filter(
    (m) => !(m.name === name && isPharmacistSource(m.source) === removingPharmacistEntry)
  );

  const removed = remaining.length < list.length;
  if (removed) await save(patientKey, remaining);
  return removed;
}

module.exports = {
  getMedications,
  addMedication,
  addMedications,
  removeMedication,
  isPharmacistSource,
  SOURCE_PHARMACIST,
  SOURCE_MANUAL,
  SOURCE_PHOTO,
  SOURCE_LEGACY,
};
