const crypto = require('crypto');

/**
 * 薬の相談用のビデオ通話リンクを発行する（Jitsi Meetの無料インスタンスを利用）
 * 会員登録不要・費用不要。ランダムなルーム名のURLを開くだけで通話が始まる
 */
function generateVideoCallLink() {
  const roomId = crypto.randomBytes(6).toString('hex');
  return `https://meet.jit.si/yakuzaishi-${roomId}`;
}

module.exports = { generateVideoCallLink };
