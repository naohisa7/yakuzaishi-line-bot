require('dotenv').config();

const express = require('express');
const line = require('@line/bot-sdk');
const { handleEvent } = require('./lineHandler');

// ────────────────────────────────────
// 環境変数チェック
// ────────────────────────────────────
const REQUIRED_ENV = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'ANTHROPIC_API_KEY',
  'PHARMACIST_LINE_USER_ID',
];

REQUIRED_ENV.forEach((key) => {
  if (!process.env[key]) {
    console.error(`❌ 環境変数 ${key} が設定されていません`);
    process.exit(1);
  }
});

// ────────────────────────────────────
// LINE SDK 設定
// ────────────────────────────────────
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new line.Client(lineConfig);

// ────────────────────────────────────
// Express アプリ設定
// ────────────────────────────────────
const app = express();

// ヘルスチェック用エンドポイント（サーバーが動作中か確認）
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'かかりつけ薬剤師 LINE Bot 稼働中',
    timestamp: new Date().toISOString(),
  });
});

// LINE Webhookエンドポイント
app.post(
  '/webhook',
  line.middleware(lineConfig),
  async (req, res) => {
    try {
      const events = req.body.events;
      await Promise.all(events.map((event) => handleEvent(event, lineClient)));
      res.json({ success: true });
    } catch (err) {
      console.error('Webhookエラー:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ────────────────────────────────────
// サーバー起動
// ────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║  かかりつけ薬剤師 LINE Bot 起動完了    ║
╚══════════════════════════════════════╝
🌐 URL:     http://localhost:${PORT}
📡 Webhook: http://localhost:${PORT}/webhook
  `);
});
