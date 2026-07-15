const crypto = require('crypto');

/**
 * 薬の相談用の通話リンクを発行する（Jitsi Meetの無料インスタンスを利用）
 * 会員登録不要・費用不要。ランダムなルーム名のURLを開くだけで通話が始まる。
 * #config.disableDeepLinking=true でスマホでもアプリのインストールを求められず、
 * そのままブラウザ内で通話が完結する。
 */
function newRoomBase() {
  const roomId = crypto.randomBytes(6).toString('hex');
  return `https://meet.jit.si/yakuzaishi-${roomId}#config.disableDeepLinking=true`;
}

function generateVideoCallLink() {
  return newRoomBase();
}

/**
 * 同じ通話ルームの「音声通話」用と「ビデオ通話」用のリンクをまとめて発行する。
 * 音声通話はカメラを最初からオフにして始める（通話中にオンにすればビデオに切替可）。
 * 患者さんと薬剤師が同じルームで会えるよう、両方とも同一ルームを指す。
 */
function buildRoomLinks() {
  const base = newRoomBase();
  return { videoLink: base, voiceLink: `${base}&config.startWithVideoMuted=true` };
}

module.exports = { generateVideoCallLink, buildRoomLinks };
