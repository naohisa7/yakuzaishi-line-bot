const redis = require('./redisClient');

/**
 * 患者さん向け認証コードを管理するモジュール（Redisに永続化）
 * LINE・ホームページで共通の1つのコードを使う
 */

const PASSCODE_KEY = 'patient_passcode';

async function getPasscode() {
  const stored = await redis.get(PASSCODE_KEY);
  return stored || process.env.PATIENT_PASSCODE;
}

async function setPasscode(code) {
  await redis.set(PASSCODE_KEY, code);
}

module.exports = { getPasscode, setPasscode };
