require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const nodemailer = require('nodemailer');
const line = require('@line/bot-sdk');
const { handleEvent } = require('./lineHandler');
const { askClaude } = require('./claudeHandler');
const { getPasscode } = require('./passcodeManager');
const { createSession, getSession, markConsented, touchSession } = require('./webSessionManager');
const { addMessage, getHistory } = require('./webConversationManager');
const { enhanceImageToBase64 } = require('./imageEnhancer');
const { PRIVACY_POLICY_TEXT } = require('./privacyPolicy');
const { registerSocket, unregisterSocket, popPendingMessages } = require('./wsManager');
const { getProfile, getArticles, getArticle } = require('./contentManager');

// ────────────────────────────────────
// 環境変数チェック
// ────────────────────────────────────
const REQUIRED_ENV = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'ANTHROPIC_API_KEY',
  'PHARMACIST_LINE_USER_ID',
  'SESSION_SECRET',
];

REQUIRED_ENV.forEach((key) => {
  if (!process.env[key]) {
    console.error(`❌ 環境変数 ${key} が設定されていません`);
    process.exit(1);
  }
});

const PHARMACIST_LINE_USER_ID = process.env.PHARMACIST_LINE_USER_ID;

// ────────────────────────────────────
// LINE SDK 設定
// ────────────────────────────────────
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new line.Client(lineConfig);

// ────────────────────────────────────
// メール送信設定（未設定の場合はメール送信をスキップ）
// ────────────────────────────────────
const mailer =
  process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
      })
    : null;
const CONTACT_EMAIL_TO = process.env.CONTACT_EMAIL_TO || process.env.EMAIL_USER;

// ────────────────────────────────────
// Express アプリ設定
// ────────────────────────────────────
const app = express();
app.use(cookieParser(process.env.SESSION_SECRET));
app.use(express.static(path.join(__dirname, '../public')));

// ヘルスチェック用エンドポイント（サーバーが動作中か確認）
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'かかりつけ薬剤師 LINE Bot 稼働中',
    timestamp: new Date().toISOString(),
  });
});

// LINE Webhookエンドポイント（署名検証のため、express.json()より前に登録する）
app.post(
  '/webhook',
  line.middleware(lineConfig),
  async (req, res) => {
    console.log(`[WEBHOOK受信] events=${req.body.events.length}件`);
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

app.use(express.json());

// ────────────────────────────────────
// ホームページ（患者さん向けチャット）
// ────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.get('/patient', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/patient.html'));
});

app.get('/api/session-status', async (req, res) => {
  const sessionId = req.signedCookies.session_id;
  const session = sessionId ? await getSession(sessionId) : null;

  if (!session) {
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    consented: session.consented,
    sessionId,
    privacyPolicy: PRIVACY_POLICY_TEXT,
  });
});

app.post('/api/verify', async (req, res) => {
  const { name, passcode } = req.body;

  if (!name || !passcode) {
    return res.json({ ok: false, message: 'お名前と認証コードを入力してください。' });
  }

  const currentPasscode = await getPasscode();
  if (!currentPasscode || passcode !== currentPasscode) {
    return res.json({ ok: false, message: '認証コードが正しくありません。' });
  }

  const sessionId = await createSession(name);
  res.cookie('session_id', sessionId, {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    maxAge: 90 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true, sessionId, privacyPolicy: PRIVACY_POLICY_TEXT });
});

async function requireWebSession(req, res, next) {
  const sessionId = req.signedCookies.session_id;
  const session = sessionId ? await getSession(sessionId) : null;

  if (!session) {
    return res.status(401).json({ error: 'セッションが無効です。ページを再読み込みしてください。' });
  }

  req.webSessionId = sessionId;
  req.webSession = session;
  next();
}

app.post('/api/consent', requireWebSession, async (req, res) => {
  await markConsented(req.webSessionId);
  res.json({ ok: true });
});

function extractDisplayText(content) {
  if (typeof content === 'string') return content;
  const textBlock = content.find((c) => c.type === 'text');
  const hasImage = content.some((c) => c.type === 'image');
  return (hasImage ? '📷 ' : '') + (textBlock ? textBlock.text : '');
}

app.get('/api/chat/history', requireWebSession, async (req, res) => {
  const history = await getHistory(req.webSessionId);
  const messages = history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    text: extractDisplayText(m.content),
  }));
  res.json({ messages });
});

app.post('/api/chat', requireWebSession, upload.single('image'), async (req, res) => {
  if (!req.webSession.consented) {
    return res.status(403).json({ error: 'プライバシーポリシーへの同意が必要です。' });
  }

  const sessionId = req.webSessionId;
  const message = (req.body.message || '').trim();
  const imageFile = req.file;

  try {
    let userContent;
    if (imageFile) {
      const imageBase64 = await enhanceImageToBase64(imageFile.buffer);
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        {
          type: 'text',
          text:
            message ||
            'この薬、または お薬手帳の写真です。商品名、ジェネリックであればメーカー名、市販薬であれば有効成分、用法用量を確認して教えてください。一包化された裸錠の場合は、薬剤名を断定せず、見えている刻印や特徴を伝えた上で薬剤師に確認してもらってください。',
        },
      ];
    } else {
      if (!message) {
        return res.status(400).json({ error: 'メッセージを入力してください。' });
      }
      userContent = message;
    }

    await addMessage(sessionId, 'user', userContent);
    await touchSession(sessionId);
    const history = await getHistory(sessionId);

    const { message: replyText, needsEscalation } = await askClaude(history);
    await addMessage(sessionId, 'assistant', replyText);

    res.json({ reply: replyText });

    if (needsEscalation && PHARMACIST_LINE_USER_ID) {
      const patientName = req.webSession.patientName || '患者さん';
      await lineClient.pushMessage(PHARMACIST_LINE_USER_ID, [
        {
          type: 'text',
          text: `🔔【要対応・ホームページより】かかりつけ患者さんから相談
━━━━━━━━━━━━━━
👤 ${patientName}（ホームページ）
━━━━━━━━━━━━━━
💬 相談内容：
${message || '（画像が送信されました）'}
━━━━━━━━━━━━━━
⚠️ チャットボットでは対応が難しい内容です。`,
        },
        {
          type: 'template',
          altText: 'この患者さんにチャットで直接返信できます',
          template: {
            type: 'buttons',
            text: '電話の代わりに、チャットで直接返信することもできます',
            actions: [
              {
                type: 'postback',
                label: '💬 チャットで返信する',
                data: `reply:web:${sessionId}`,
                displayText: '💬 チャットで返信する',
              },
            ],
          },
        },
      ]);
      console.log(`[ESCALATE-WEB] sessionId: ${sessionId} の相談を薬剤師に通知しました`);
    }
  } catch (err) {
    console.error('Webチャットエラー:', err);
    res.status(500).json({ error: '現在システムの調子が良くありません。しばらくしてから再度お試しください。' });
  }
});

// ────────────────────────────────────
// 薬剤師個人ホームページ（プロフィール・記事・仕事の依頼）
// ────────────────────────────────────

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/profile.html'));
});

app.get('/api/profile', async (req, res) => {
  try {
    res.json({ text: await getProfile() });
  } catch (err) {
    console.error('プロフィール取得エラー:', err);
    res.status(500).json({ error: 'プロフィールを取得できませんでした。' });
  }
});

app.get('/articles', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/articles.html'));
});

app.get('/articles/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/article.html'));
});

app.get('/api/articles', async (req, res) => {
  try {
    const articles = (await getArticles()).map(({ id, title, createdAt }) => ({ id, title, createdAt }));
    res.json({ articles });
  } catch (err) {
    console.error('記事一覧取得エラー:', err);
    res.status(500).json({ error: '記事一覧を取得できませんでした。' });
  }
});

app.get('/api/articles/:id', async (req, res) => {
  try {
    const article = await getArticle(req.params.id);
    if (!article) {
      return res.status(404).json({ error: '記事が見つかりません。' });
    }
    res.json(article);
  } catch (err) {
    console.error('記事取得エラー:', err);
    res.status(500).json({ error: '記事を取得できませんでした。' });
  }
});

app.get('/contact', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/contact.html'));
});

app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.json({ ok: false, message: 'すべての項目を入力してください。' });
  }

  try {
    if (PHARMACIST_LINE_USER_ID) {
      await lineClient.pushMessage(PHARMACIST_LINE_USER_ID, {
        type: 'text',
        text: `💼【仕事のご依頼】ホームページより
━━━━━━━━━━━━━━
👤 お名前・会社名：${name}
📧 連絡先：${email}
━━━━━━━━━━━━━━
💬 依頼内容：
${message}`,
      });
    }

    if (mailer && CONTACT_EMAIL_TO) {
      await mailer.sendMail({
        from: process.env.EMAIL_USER,
        to: CONTACT_EMAIL_TO,
        replyTo: email,
        subject: `【仕事のご依頼】${name}様より`,
        text: `お名前・会社名：${name}\n連絡先：${email}\n\n依頼内容：\n${message}`,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('お問い合わせ送信エラー:', err);
    res.status(500).json({ ok: false, message: '送信に失敗しました。しばらくしてから再度お試しください。' });
  }
});

// ────────────────────────────────────
// サーバー起動 ＋ WebSocket
// ────────────────────────────────────
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('session');
  const session = sessionId ? await getSession(sessionId) : null;

  if (!session) {
    ws.close();
    return;
  }

  registerSocket(sessionId, ws);

  const pending = await popPendingMessages(sessionId);
  pending.forEach((msg) => ws.send(JSON.stringify(msg)));

  ws.on('close', () => unregisterSocket(sessionId, ws));
});

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║  かかりつけ薬剤師 LINE Bot 起動完了    ║
╚══════════════════════════════════════╝
🌐 URL:     http://localhost:${PORT}
📡 Webhook: http://localhost:${PORT}/webhook
🖥️  Web:     http://localhost:${PORT}/
  `);
});
