const redis = require('./redisClient');

/**
 * ホームページの管理者ページ（記事の追加・編集・削除）用パスコードを管理するモジュール
 * 患者さん向けのpasscodeManager.jsとは別物。LINEの「管理者パスワード変更:新しいパスワード」で変更する
 */

const ADMIN_PASSCODE_KEY = 'admin_passcode';

async function getAdminPasscode() {
  const stored = await redis.get(ADMIN_PASSCODE_KEY);
  return stored || process.env.ADMIN_PASSCODE || null;
}

async function setAdminPasscode(code) {
  await redis.set(ADMIN_PASSCODE_KEY, code);
}

module.exports = { getAdminPasscode, setAdminPasscode };
