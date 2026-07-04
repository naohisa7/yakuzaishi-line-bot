require('dotenv').config();

// Render環境はIPv6での発信ができないため、DNS解決をIPv4優先にする
// （設定しないとGmail SMTP等への接続がENETUNREACHで失敗する）
require('dns').setDefaultResultOrder('ipv4first');

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
const { createSession, getSession, markConsented, touchSession, listSessionIds, removeSessionId } = require('./webSessionManager');
const { addMessage, getHistory } = require('./webConversationManager');
const { getHistory: getLineHistory, addMessage: addLineMessage } = require('./conversationManager');
const { getAuthorizedUsers } = require('./authManager');
const { enhanceImageToBase64 } = require('./imageEnhancer');
const { PRIVACY_POLICY_TEXT } = require('./privacyPolicy');
const { registerSocket, unregisterSocket, popPendingMessages, sendToSession } = require('./wsManager');
const { getProfile, getArticles, getArticle, addArticle, updateArticle, deleteArticle } = require('./contentManager');
const { recordFeedback } = require('./feedbackLogManager');
const { getMedications, addMedication, removeMedication } = require('./medicationRecordManager');
const { generateVideoCallLink } = require('./videoCallLink');
const { getAdminPasscode } = require('./adminPasscodeManager');
const { createAdminSession, isValidAdminSession } = require('./adminSessionManager');

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
const PHARMACIST_PHONE = process.env.PHARMACIST_PHONE || '';

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
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        requireTLS: true,
        family: 4, // RenderがIPv6発信に対応していないため強制的にIPv4接続にする
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

function buildWebReplyButtonMessage(sessionId) {
  return {
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
  };
}

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

    // お薬手帳に記録済みの薬があれば文脈として渡す
    const knownMedications = await getMedications(`web:${sessionId}`);
    const { message: replyText, needsEscalation, savedDrugs } = await askClaude(history, knownMedications);
    await addMessage(sessionId, 'assistant', replyText);

    // 確実に特定できた薬があればお薬手帳に記録
    for (const drugName of savedDrugs) {
      await addMedication(`web:${sessionId}`, drugName);
    }

    const videoLink = needsEscalation ? generateVideoCallLink() : undefined;

    res.json({
      reply: replyText,
      needsEscalation,
      phone: needsEscalation ? PHARMACIST_PHONE : undefined,
      videoLink,
    });

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
⚠️ チャットボットでは対応が難しい内容です。
📹 ビデオ通話で参加する場合：
${videoLink}`,
        },
        buildWebReplyButtonMessage(sessionId),
      ]);
      console.log(`[ESCALATE-WEB] sessionId: ${sessionId} の相談を薬剤師に通知しました`);
    }
  } catch (err) {
    console.error('Webチャットエラー:', err);
    res.status(500).json({ error: '現在システムの調子が良くありません。しばらくしてから再度お試しください。' });
  }
});

app.post('/api/chat/resolution', requireWebSession, async (req, res) => {
  const sessionId = req.webSessionId;
  const resolved = !!req.body.resolved;
  const feedback = (req.body.feedback || '').trim();

  if (resolved) {
    return res.json({ ok: true });
  }

  try {
    const patientName = req.webSession.patientName || '患者さん（ホームページ）';

    if (feedback) {
      await recordFeedback(patientName, feedback);
      if (PHARMACIST_LINE_USER_ID) {
        await lineClient.pushMessage(PHARMACIST_LINE_USER_ID, [
          {
            type: 'text',
            text: `📝【フィードバック詳細・ホームページより】チャットボットで解決できなかったとの回答
━━━━━━━━━━━━━━
👤 ${patientName}（ホームページ）
━━━━━━━━━━━━━━
💬 いただいた内容：
${feedback}`,
          },
          buildWebReplyButtonMessage(sessionId),
        ]);
      }
    } else if (PHARMACIST_LINE_USER_ID) {
      await lineClient.pushMessage(PHARMACIST_LINE_USER_ID, [
        {
          type: 'text',
          text: `❌【要フォロー・ホームページより】チャットボットで解決しなかったと回答
━━━━━━━━━━━━━━
👤 ${patientName}（ホームページ）
━━━━━━━━━━━━━━
詳しい理由は追ってお伝えします。お急ぎであればこちらから先にチャットできます。`,
        },
        buildWebReplyButtonMessage(sessionId),
      ]);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('解決確認フィードバック送信エラー:', err);
    res.status(500).json({ ok: false });
  }
});

app.get('/medications', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/medications.html'));
});

app.get('/api/medications', requireWebSession, async (req, res) => {
  try {
    const medications = await getMedications(`web:${req.webSessionId}`);
    res.json({ medications });
  } catch (err) {
    console.error('お薬手帳取得エラー:', err);
    res.status(500).json({ error: 'お薬手帳を取得できませんでした。' });
  }
});

app.post('/api/medications/delete', requireWebSession, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: '薬品名を指定してください。' });
  }

  try {
    await removeMedication(`web:${req.webSessionId}`, name);
    res.json({ ok: true });
  } catch (err) {
    console.error('お薬手帳削除エラー:', err);
    res.status(500).json({ ok: false });
  }
});

app.post('/api/video-call', requireWebSession, async (req, res) => {
  try {
    const videoLink = generateVideoCallLink();
    const patientName = req.webSession.patientName || '患者さん（ホームページ）';

    if (PHARMACIST_LINE_USER_ID) {
      await lineClient.pushMessage(PHARMACIST_LINE_USER_ID, [
        {
          type: 'text',
          text: `📹【ビデオ通話希望・ホームページより】${patientName}さんがビデオ通話を希望しています
━━━━━━━━━━━━━━
参加はこちら：
${videoLink}`,
        },
        buildWebReplyButtonMessage(req.webSessionId),
      ]);
    }

    res.json({ videoLink });
  } catch (err) {
    console.error('ビデオ通話リンク発行エラー:', err);
    res.status(500).json({ error: 'ビデオ通話を開始できませんでした。しばらくしてから再度お試しください。' });
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

// ────────────────────────────────────
// 記事管理ページ（薬剤師のみ・パスワードでログイン）
// ────────────────────────────────────

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/api/admin/session-status', async (req, res) => {
  const adminSessionId = req.signedCookies.admin_session;
  const authenticated = await isValidAdminSession(adminSessionId);
  res.json({ authenticated });
});

app.post('/api/admin/login', async (req, res) => {
  const password = (req.body.password || '').trim();
  const currentPasscode = await getAdminPasscode();

  if (!currentPasscode || password !== currentPasscode) {
    return res.json({ ok: false, message: 'パスワードが正しくありません。' });
  }

  const adminSessionId = await createAdminSession();
  res.cookie('admin_session', adminSessionId, {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

async function requireAdminSession(req, res, next) {
  const adminSessionId = req.signedCookies.admin_session;
  const authenticated = await isValidAdminSession(adminSessionId);

  if (!authenticated) {
    return res.status(401).json({ error: '管理者ログインが必要です。' });
  }

  next();
}

app.get('/api/admin/articles', requireAdminSession, async (req, res) => {
  try {
    const articles = await getArticles();
    res.json({ articles });
  } catch (err) {
    console.error('記事一覧取得エラー（管理）:', err);
    res.status(500).json({ error: '記事一覧を取得できませんでした。' });
  }
});

app.get('/api/admin/articles/:id', requireAdminSession, async (req, res) => {
  try {
    const article = await getArticle(req.params.id);
    if (!article) {
      return res.status(404).json({ error: '記事が見つかりません。' });
    }
    res.json(article);
  } catch (err) {
    console.error('記事取得エラー（管理）:', err);
    res.status(500).json({ error: '記事を取得できませんでした。' });
  }
});

app.post('/api/admin/articles', requireAdminSession, async (req, res) => {
  const title = (req.body.title || '').trim();
  const body = (req.body.body || '').trim();

  if (!title || !body) {
    return res.status(400).json({ error: 'タイトルと本文を入力してください。' });
  }

  try {
    const article = await addArticle(title, body);
    res.json({ ok: true, article });
  } catch (err) {
    console.error('記事追加エラー（管理）:', err);
    res.status(500).json({ error: '記事を追加できませんでした。' });
  }
});

app.put('/api/admin/articles/:id', requireAdminSession, async (req, res) => {
  const title = (req.body.title || '').trim();
  const body = (req.body.body || '').trim();

  if (!title || !body) {
    return res.status(400).json({ error: 'タイトルと本文を入力してください。' });
  }

  try {
    const updated = await updateArticle(req.params.id, title, body);
    if (!updated) {
      return res.status(404).json({ error: '記事が見つかりません。' });
    }
    res.json({ ok: true, article: updated });
  } catch (err) {
    console.error('記事更新エラー（管理）:', err);
    res.status(500).json({ error: '記事を更新できませんでした。' });
  }
});

app.delete('/api/admin/articles/:id', requireAdminSession, async (req, res) => {
  try {
    await deleteArticle(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('記事削除エラー（管理）:', err);
    res.status(500).json({ error: '記事を削除できませんでした。' });
  }
});

// ────────────────────────────────────
// 患者チャットコンソール（薬剤師のみ・/adminと同じログイン）
// ────────────────────────────────────

app.get('/console', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/chat-console.html'));
});

app.get('/api/admin/patients', requireAdminSession, async (req, res) => {
  try {
    const lineIds = (await getAuthorizedUsers()).filter((id) => id !== PHARMACIST_LINE_USER_ID);
    const linePatients = await Promise.all(
      lineIds.map(async (id) => {
        try {
          const profile = await lineClient.getProfile(id);
          return { id, type: 'line', name: profile.displayName };
        } catch (_) {
          return { id, type: 'line', name: '（表示名不明）' };
        }
      })
    );

    const webIds = await listSessionIds();
    const webPatients = [];
    for (const id of webIds) {
      const session = await getSession(id);
      if (!session) {
        await removeSessionId(id); // 期限切れセッションを掃除
        continue;
      }
      if (!session.consented) continue; // 同意前の未完了ログインは表示しない
      webPatients.push({ id: `web:${id}`, type: 'web', name: session.patientName });
    }

    res.json({ patients: [...linePatients, ...webPatients] });
  } catch (err) {
    console.error('患者一覧取得エラー（コンソール）:', err);
    res.status(500).json({ error: '患者一覧を取得できませんでした。' });
  }
});

app.get('/api/admin/patients/:id/messages', requireAdminSession, async (req, res) => {
  try {
    const target = req.params.id;
    const history = target.startsWith('web:')
      ? await getHistory(target.slice(4))
      : getLineHistory(target); // conversationManagerは同期関数

    const messages = history.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      text: extractDisplayText(m.content),
    }));
    res.json({ messages });
  } catch (err) {
    console.error('患者スレッド取得エラー（コンソール）:', err);
    res.status(500).json({ error: 'メッセージを取得できませんでした。' });
  }
});

app.post('/api/admin/patients/:id/messages', requireAdminSession, async (req, res) => {
  const target = req.params.id;
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: '本文を入力してください。' });

  const replyText = `💊 担当薬剤師からの返信\n━━━━━━━━━━━━━━\n${text}`;

  try {
    if (target.startsWith('web:')) {
      const sessionId = target.slice(4);
      const session = await getSession(sessionId);
      if (!session) return res.status(404).json({ error: '患者さんが見つかりません。' });
      await sendToSession(sessionId, { text: replyText });
      await addMessage(sessionId, 'assistant', replyText);
    } else {
      await lineClient.pushMessage(target, { type: 'text', text: replyText });
      addLineMessage(target, 'assistant', replyText);
    }
    res.json({ ok: true, message: { role: 'assistant', text: replyText } });
  } catch (err) {
    console.error('チャットコンソール送信エラー:', err);
    res.status(500).json({ error: '送信できませんでした。' });
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

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  registerSocket(sessionId, ws);

  const pending = await popPendingMessages(sessionId);
  pending.forEach((msg) => ws.send(JSON.stringify(msg)));

  ws.on('close', () => unregisterSocket(sessionId, ws));
  ws.on('error', () => {}); // 予期しないエラーでプロセスが落ちないようにする
});

// スマホの画面ロックや電波切れなどで「見た目上は接続中だが実際には
// 応答しない」ソケットを定期的に検出し、切断扱いにして保留キューへの
// フォールバックが正しく働くようにする
const WS_HEARTBEAT_INTERVAL_MS = 30000;
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, WS_HEARTBEAT_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeatInterval));

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
