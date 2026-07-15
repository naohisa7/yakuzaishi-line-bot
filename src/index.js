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
const { askClaude, extractMedicationsFromImage } = require('./claudeHandler');
const { getPasscode } = require('./passcodeManager');
const { createSession, getSession, markConsented, touchSession, listSessionIds, removeSessionId, deleteSession } = require('./webSessionManager');
const { addMessage, getHistory } = require('./webConversationManager');
const { getHistory: getLineHistory, addMessage: addLineMessage } = require('./conversationManager');
const { getAuthorizedUsers, revoke: revokeAuthorization } = require('./authManager');
const BROADCAST_TEMPLATES = require('./broadcastTemplates');
const { enhanceImageToBase64 } = require('./imageEnhancer');
const { PRIVACY_POLICY_TEXT } = require('./privacyPolicy');
const { registerSocket, unregisterSocket, popPendingMessages, sendToSession } = require('./wsManager');
const { getPharmacistName, getArticles, getArticle, addArticle, updateArticle, deleteArticle } = require('./contentManager');
const { recordFeedback } = require('./feedbackLogManager');
const {
  getMedications,
  addMedication,
  addMedications,
  removeMedication,
  SOURCE_PHOTO,
  SOURCE_PHARMACIST,
} = require('./medicationRecordManager');
const { searchDrugs, matchDrugName, MIN_QUERY_LENGTH } = require('./drugMaster');
const {
  linkBooks,
  unlinkBooks,
  getLinkedLineKey,
  getLinkedWebKey,
  resolveLinkCode,
} = require('./medicationBookLinkManager');
const { getInterventions, addIntervention, updateIntervention, removeIntervention } = require('./interventionRecordManager');
const { getReminders, addReminder, removeReminder, listReminderPatientKeys, markSent } = require('./reminderManager');
const { generateVideoCallLink } = require('./videoCallLink');
const { formatPatientMessages } = require('./escalationSummary');
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
const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  },
});

// アップロードエラー（画像以外のファイル・サイズ超過など）を、他のAPIと同じJSON形式で返す
function uploadImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();

    const message =
      err.message === 'INVALID_FILE_TYPE'
        ? '画像ファイル（JPEG・PNG・WebP・HEIC）のみ添付できます。'
        : err.code === 'LIMIT_FILE_SIZE'
        ? 'ファイルサイズは10MBまでにしてください。'
        : 'ファイルを読み込めませんでした。';
    res.status(400).json({ error: message });
  });
}

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

app.post('/api/chat', requireWebSession, uploadImage, async (req, res) => {
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

    // 写真から確実に特定できた薬があればお薬手帳に記録
    // （テキストで名前を言われただけのものは askClaude 側で除外済み）
    for (const drugName of savedDrugs) {
      await addMedication(`web:${sessionId}`, drugName, SOURCE_PHOTO);
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
      const messagesSummary =
        formatPatientMessages(history) || message || '（画像が送信されました）';
      await lineClient.pushMessage(PHARMACIST_LINE_USER_ID, [
        {
          type: 'text',
          text: `🔔【要対応・ホームページより】かかりつけ患者さんから相談
━━━━━━━━━━━━━━
👤 ${patientName}（ホームページ）
━━━━━━━━━━━━━━
💬 ご相談の流れ（患者さんの発言）：
${messagesSummary}
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

app.get('/guide', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/guide.html'));
});

app.get('/api/medications', requireWebSession, async (req, res) => {
  try {
    const webKey = `web:${req.webSessionId}`;
    const [medications, pharmacistName, linkedLineKey] = await Promise.all([
      getMedications(webKey),
      getPharmacistName(),
      getLinkedLineKey(webKey),
    ]);
    res.json({ medications, pharmacistName, linkedWithLine: !!linkedLineKey });
  } catch (err) {
    console.error('お薬手帳取得エラー:', err);
    res.status(500).json({ error: 'お薬手帳を取得できませんでした。' });
  }
});

// 医薬品マスタから薬品名（規格込み）の候補を検索する。3文字以上でのみ検索する
// 患者さんにはメーカー名（「トーワ」等）の区別は難しく候補も膨らむため、除いた名称を返す
app.get('/api/drugs/search', requireWebSession, (req, res) => {
  const query = (req.query.q || '').trim();

  if (query.length < MIN_QUERY_LENGTH) {
    return res.json({ drugs: [], minLength: MIN_QUERY_LENGTH });
  }

  res.json({
    drugs: searchDrugs(query, { includeManufacturer: false }),
    minLength: MIN_QUERY_LENGTH,
  });
});

// 患者さんが選んだお薬をまとめて登録する
app.post('/api/medications', requireWebSession, async (req, res) => {
  const names = Array.isArray(req.body.names) ? req.body.names : [];
  if (names.length === 0) {
    return res.status(400).json({ error: '登録するお薬を選んでください。' });
  }

  try {
    const added = await addMedications(`web:${req.webSessionId}`, names);
    res.json({ ok: true, added });
  } catch (err) {
    console.error('お薬手帳登録エラー:', err);
    res.status(500).json({ error: 'お薬を登録できませんでした。' });
  }
});

app.post('/api/medications/delete', requireWebSession, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: '薬品名を指定してください。' });
  }

  try {
    // 患者さんは、薬剤師が登録したお薬は削除できない（scope: 'patient'）
    const removed = await removeMedication(`web:${req.webSessionId}`, name, 'patient');
    if (!removed) {
      return res.status(403).json({ error: '薬剤師が登録したお薬は削除できません。' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('お薬手帳削除エラー:', err);
    res.status(500).json({ ok: false });
  }
});

// 患者さんが、LINEで発行した6桁コードを入力してお薬手帳を同期する
app.post('/api/medications/link', requireWebSession, async (req, res) => {
  const code = (req.body.code || '').trim();
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: '6桁の連携コードを入力してください。' });
  }

  try {
    const lineKey = await resolveLinkCode(code);
    if (!lineKey) {
      return res
        .status(400)
        .json({ error: 'コードが正しくないか、有効期限（10分）が切れています。LINEで発行し直してください。' });
    }

    const result = await linkBooks(`web:${req.webSessionId}`, lineKey);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ ok: true, merged: result.merged });
  } catch (err) {
    console.error('お薬手帳の連携エラー:', err);
    res.status(500).json({ error: '連携できませんでした。' });
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

app.get('/host-guide', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/host-guide.html'));
});

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/host.html'));
});

/**
 * LINE・ホームページ両方の認証済み患者を、patientKey（line:<id> / web:<id>）付きで列挙する
 */
async function getAllPatientsWithNames() {
  const lineIds = (await getAuthorizedUsers()).filter((id) => id !== PHARMACIST_LINE_USER_ID);
  const linePatients = await Promise.all(
    lineIds.map(async (id) => {
      let name;
      try {
        const profile = await lineClient.getProfile(id);
        name = profile.displayName;
      } catch (_) {
        name = '（表示名不明）';
      }
      return { id, patientKey: `line:${id}`, type: 'line', name };
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
    webPatients.push({ id: `web:${id}`, patientKey: `web:${id}`, type: 'web', name: session.patientName });
  }

  return [...linePatients, ...webPatients];
}

/**
 * 対応記録から、フォローアップ加算・訪問加算の目安になるフラグを計算する
 * （実際のレセプト算定実績そのものではなく、対応記録を代理指標として使う近似）
 */
function computeReminderFlags(records) {
  const sixMonthsAgoMs = Date.now() - 183 * 24 * 60 * 60 * 1000;
  const followUpDue = records.some(
    (r) => (r.type === 'remaining_med' || r.type === 'adverse_event') && new Date(r.recordedAt).getTime() >= sixMonthsAgoMs
  );
  const latestVisit = records.find((r) => r.type === 'visit'); // getInterventionsは新しい順
  const visitDue = !!latestVisit && new Date(latestVisit.recordedAt).getTime() < sixMonthsAgoMs;
  return { followUpDue, visitDue };
}

app.get('/api/admin/patients', requireAdminSession, async (req, res) => {
  try {
    const allPatients = await getAllPatientsWithNames();
    const patients = await Promise.all(
      allPatients.map(async ({ id, type, name, patientKey }) => {
        const flags = computeReminderFlags(await getInterventions(patientKey));
        return { id, type, name, ...flags };
      })
    );

    res.json({ patients });
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

app.get('/api/admin/patients/:id/interventions', requireAdminSession, async (req, res) => {
  try {
    const target = req.params.id;
    const patientKey = target.startsWith('web:') ? target : `line:${target}`;
    const records = await getInterventions(patientKey);
    res.json({ records });
  } catch (err) {
    console.error('対応記録取得エラー（コンソール）:', err);
    res.status(500).json({ error: '対応記録を取得できませんでした。' });
  }
});

app.post('/api/admin/patients/:id/interventions', requireAdminSession, async (req, res) => {
  const target = req.params.id;
  const type = (req.body.type || '').trim();
  const note = (req.body.note || '').trim();
  const validTypes = ['follow_up', 'remaining_med', 'adverse_event', 'visit', 'other'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: '対応の種類が正しくありません。' });
  }

  try {
    const patientKey = target.startsWith('web:') ? target : `line:${target}`;
    await addIntervention(patientKey, type, note);
    res.json({ ok: true });
  } catch (err) {
    console.error('対応記録追加エラー（コンソール）:', err);
    res.status(500).json({ error: '対応記録を保存できませんでした。' });
  }
});

app.put('/api/admin/patients/:id/interventions/:recordId', requireAdminSession, async (req, res) => {
  const target = req.params.id;
  const type = (req.body.type || '').trim();
  const note = (req.body.note || '').trim();
  const validTypes = ['follow_up', 'remaining_med', 'adverse_event', 'visit', 'other'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: '対応の種類が正しくありません。' });
  }

  try {
    const patientKey = target.startsWith('web:') ? target : `line:${target}`;
    const updated = await updateIntervention(patientKey, req.params.recordId, type, note);
    if (!updated) return res.status(404).json({ error: '対応記録が見つかりません。' });
    res.json({ ok: true });
  } catch (err) {
    console.error('対応記録更新エラー（コンソール）:', err);
    res.status(500).json({ error: '対応記録を更新できませんでした。' });
  }
});

app.delete('/api/admin/patients/:id/interventions/:recordId', requireAdminSession, async (req, res) => {
  try {
    const target = req.params.id;
    const patientKey = target.startsWith('web:') ? target : `line:${target}`;
    await removeIntervention(patientKey, req.params.recordId);
    res.json({ ok: true });
  } catch (err) {
    console.error('対応記録削除エラー（コンソール）:', err);
    res.status(500).json({ error: '対応記録を削除できませんでした。' });
  }
});

const INTERVENTION_TYPE_LABELS = {
  follow_up: 'フォローアップ（電話等）',
  remaining_med: '残薬調整',
  adverse_event: '有害事象防止（処方変更）',
  visit: '訪問',
  other: 'その他',
};

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

app.get('/api/admin/interventions/export', requireAdminSession, async (req, res) => {
  const month = (req.query.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: '月を指定してください（例: 2026-07）。' });
  }

  try {
    const allPatients = await getAllPatientsWithNames();
    const rows = [];

    for (const patient of allPatients) {
      const records = await getInterventions(patient.patientKey);
      records
        .filter((r) => r.recordedAt.startsWith(month))
        .forEach((r) => {
          rows.push({
            recordedAt: r.recordedAt,
            name: patient.name,
            channel: patient.type === 'line' ? 'LINE' : 'Web',
            typeLabel: INTERVENTION_TYPE_LABELS[r.type] || r.type,
            note: r.note || '',
          });
        });
    }

    rows.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

    const header = ['日時', '患者名', 'チャネル', '種類', '内容'].join(',');
    const lines = rows.map((r) =>
      [r.recordedAt, r.name, r.channel, r.typeLabel, r.note].map(csvEscape).join(',')
    );
    const csv = '﻿' + [header, ...lines].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="taiou-kiroku-${month}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('対応記録CSV出力エラー:', err);
    res.status(500).json({ error: 'CSVを出力できませんでした。' });
  }
});

app.get('/api/admin/patients/:id/reminder', requireAdminSession, async (req, res) => {
  try {
    const target = req.params.id;
    const patientKey = target.startsWith('web:') ? target : `line:${target}`;
    res.json({ reminders: await getReminders(patientKey) });
  } catch (err) {
    console.error('リマインダー取得エラー:', err);
    res.status(500).json({ error: 'リマインダー設定を取得できませんでした。' });
  }
});

app.post('/api/admin/patients/:id/reminder', requireAdminSession, async (req, res) => {
  const target = req.params.id;
  const time = (req.body.time || '').trim();
  const message = (req.body.message || '').trim();
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: '時刻を指定してください（例: 08:00）。' });
  }

  try {
    const patientKey = target.startsWith('web:') ? target : `line:${target}`;
    await addReminder(patientKey, time, message);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'リマインダーを設定できませんでした。' });
  }
});

app.delete('/api/admin/patients/:id/reminder/:reminderId', requireAdminSession, async (req, res) => {
  try {
    const target = req.params.id;
    const patientKey = target.startsWith('web:') ? target : `line:${target}`;
    await removeReminder(patientKey, req.params.reminderId);
    res.json({ ok: true });
  } catch (err) {
    console.error('リマインダー解除エラー:', err);
    res.status(500).json({ error: 'リマインダーを解除できませんでした。' });
  }
});

/**
 * かかりつけとして担当している患者さんかどうかを確認し、patientKeyに変換する
 *
 * 担当患者＝認証済みのLINE患者、または同意済みのWebセッション患者（＝/consoleの患者一覧）。
 * 一覧に無いIDが渡された場合は、そこへお薬を書き込めないようにする。
 */
async function resolveManagedPatientKey(target) {
  const patients = await getAllPatientsWithNames();
  const patient = patients.find((p) => p.id === target);
  return patient ? patient.patientKey : null;
}

// 薬剤師が、担当患者さんのお薬手帳を見る
app.get('/api/admin/patients/:id/medications', requireAdminSession, async (req, res) => {
  try {
    const patientKey = await resolveManagedPatientKey(req.params.id);
    if (!patientKey) {
      return res.status(404).json({ error: '担当されている患者さんが見つかりません。' });
    }
    res.json({ medications: await getMedications(patientKey) });
  } catch (err) {
    console.error('お薬手帳取得エラー（コンソール）:', err);
    res.status(500).json({ error: 'お薬手帳を取得できませんでした。' });
  }
});

// 薬剤師が、担当患者さんのお薬手帳にまとめて登録する
app.post('/api/admin/patients/:id/medications', requireAdminSession, async (req, res) => {
  const names = Array.isArray(req.body.names) ? req.body.names : [];
  if (names.length === 0) {
    return res.status(400).json({ error: '登録するお薬を選んでください。' });
  }

  try {
    const patientKey = await resolveManagedPatientKey(req.params.id);
    if (!patientKey) {
      return res.status(404).json({ error: '担当されている患者さんが見つかりません。' });
    }

    const added = await addMedications(patientKey, names, SOURCE_PHARMACIST);
    res.json({ ok: true, added });
  } catch (err) {
    console.error('お薬手帳登録エラー（コンソール）:', err);
    res.status(500).json({ error: 'お薬を登録できませんでした。' });
  }
});

/**
 * 薬剤師が、処方箋・お薬手帳・薬の写真から薬品名を読み取る
 *
 * ここでは登録しない。読み取った候補を返すだけで、薬剤師が画面で内容を確認してから
 * 改めて登録APIを叩く（AIの誤読をそのままお薬手帳に記録しないため）。
 */
app.post(
  '/api/admin/patients/:id/medications/scan',
  requireAdminSession,
  uploadImage,
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: '画像を選択してください。' });
    }

    try {
      const patientKey = await resolveManagedPatientKey(req.params.id);
      if (!patientKey) {
        return res.status(404).json({ error: '担当されている患者さんが見つかりません。' });
      }

      const imageBase64 = await enhanceImageToBase64(req.file.buffer);
      const { names, note } = await extractMedicationsFromImage(imageBase64);

      // 読み取った名前を医薬品マスタの正式名称に直す。マスタに無いものはそのまま返し、
      // 「マスタ未登録」であることを画面で薬剤師に示す
      const drugs = names.map((name) => matchDrugName(name));

      res.json({ drugs, note });
    } catch (err) {
      console.error('画像からの薬品名読み取りエラー（コンソール）:', err);
      res.status(500).json({ error: '画像を読み取れませんでした。' });
    }
  }
);

/**
 * 薬剤師が、ホームページの患者さんとLINEの患者さんを同一人物として紐づける
 * （紐づけるとお薬手帳が1冊に統合され、以後どちらから登録しても同期する）
 */
app.get('/api/admin/patients/:id/medication-link', requireAdminSession, async (req, res) => {
  const target = req.params.id;

  try {
    const patients = await getAllPatientsWithNames();
    if (!patients.some((p) => p.id === target)) {
      return res.status(404).json({ error: '担当されている患者さんが見つかりません。' });
    }

    // 紐づけの相手候補（LINEの患者さん）と、現在の紐づけ状況を返す
    const lineCandidates = patients
      .filter((p) => p.type === 'line')
      .map((p) => ({ id: p.id, name: p.name }));

    const linkedTo = target.startsWith('web:')
      ? await getLinkedLineKey(target)
      : await getLinkedWebKey(`line:${target}`);

    let linkedName = null;
    if (linkedTo) {
      const linkedId = linkedTo.startsWith('line:') ? linkedTo.slice(5) : linkedTo;
      const linkedPatient = patients.find((p) => p.id === linkedId);
      linkedName = linkedPatient ? linkedPatient.name : '（一覧にない患者さん）';
    }

    res.json({
      type: target.startsWith('web:') ? 'web' : 'line',
      linked: !!linkedTo,
      linkedName,
      lineCandidates,
    });
  } catch (err) {
    console.error('お薬手帳連携の取得エラー（コンソール）:', err);
    res.status(500).json({ error: '連携状況を取得できませんでした。' });
  }
});

app.post('/api/admin/patients/:id/medication-link', requireAdminSession, async (req, res) => {
  const target = req.params.id; // ホームページの患者さん（web:<sid>）
  const lineUserId = (req.body.lineUserId || '').trim();

  if (!target.startsWith('web:')) {
    return res.status(400).json({ error: 'ホームページの患者さんを選んでから紐づけてください。' });
  }

  try {
    const patients = await getAllPatientsWithNames();
    // 担当している患者さん同士でしか紐づけられないようにする
    if (!patients.some((p) => p.id === target)) {
      return res.status(404).json({ error: '担当されている患者さんが見つかりません。' });
    }
    if (!patients.some((p) => p.id === lineUserId && p.type === 'line')) {
      return res.status(404).json({ error: '担当されているLINEの患者さんが見つかりません。' });
    }

    const result = await linkBooks(target, `line:${lineUserId}`);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ ok: true, merged: result.merged });
  } catch (err) {
    console.error('お薬手帳連携エラー（コンソール）:', err);
    res.status(500).json({ error: '紐づけできませんでした。' });
  }
});

app.delete('/api/admin/patients/:id/medication-link', requireAdminSession, async (req, res) => {
  const target = req.params.id;

  if (!target.startsWith('web:')) {
    return res.status(400).json({ error: 'ホームページの患者さんを選んでから解除してください。' });
  }

  try {
    const patients = await getAllPatientsWithNames();
    if (!patients.some((p) => p.id === target)) {
      return res.status(404).json({ error: '担当されている患者さんが見つかりません。' });
    }

    const result = await unlinkBooks(target);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('お薬手帳連携解除エラー（コンソール）:', err);
    res.status(500).json({ error: '解除できませんでした。' });
  }
});

// 薬剤師が、自分で登録したお薬を削除する（患者さんが登録したお薬は消せない）
app.post('/api/admin/patients/:id/medications/delete', requireAdminSession, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: '薬品名を指定してください。' });
  }

  try {
    const patientKey = await resolveManagedPatientKey(req.params.id);
    if (!patientKey) {
      return res.status(404).json({ error: '担当されている患者さんが見つかりません。' });
    }

    const removed = await removeMedication(patientKey, name, 'pharmacist');
    if (!removed) {
      return res.status(403).json({ error: '患者さんご自身が登録したお薬は、薬剤師からは削除できません。' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('お薬手帳削除エラー（コンソール）:', err);
    res.status(500).json({ error: 'お薬を削除できませんでした。' });
  }
});

// 薬剤師コンソールからの薬品名検索
// 薬剤師は実際に調剤した銘柄を記録する必要があるため、メーカー名込みの正式名称を返す
app.get('/api/admin/drugs/search', requireAdminSession, (req, res) => {
  const query = (req.query.q || '').trim();
  if (query.length < MIN_QUERY_LENGTH) {
    return res.json({ drugs: [], minLength: MIN_QUERY_LENGTH });
  }
  res.json({
    drugs: searchDrugs(query, { includeManufacturer: true }),
    minLength: MIN_QUERY_LENGTH,
  });
});

app.get('/api/cron/medication-reminders', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.token !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const parts = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    const currentHHMM = `${get('hour')}:${get('minute')}`;
    const todayStr = `${get('year')}-${get('month')}-${get('day')}`;

    const patientKeys = await listReminderPatientKeys();
    let sent = 0;
    for (const patientKey of patientKeys) {
      const reminders = await getReminders(patientKey);
      for (const reminder of reminders) {
        if (reminder.lastSentDate === todayStr) continue;
        if (currentHHMM < reminder.time) continue; // まだ設定時刻前

        const text = reminder.message || '💊 お薬を飲む時間です。飲み忘れがないかご確認ください。';
        try {
          if (patientKey.startsWith('web:')) {
            await sendToSession(patientKey.slice(4), { text });
          } else {
            await lineClient.pushMessage(patientKey.slice(5), { type: 'text', text });
          }
          await markSent(patientKey, reminder.id, todayStr);
          sent++;
        } catch (err) {
          console.error('リマインダー送信エラー:', patientKey, reminder.id, err.message);
        }
      }
    }
    res.json({ ok: true, sent });
  } catch (err) {
    console.error('服薬リマインダーcronエラー:', err);
    res.status(500).json({ error: 'リマインダー処理に失敗しました。' });
  }
});

app.get('/api/admin/broadcast-templates', requireAdminSession, (req, res) => {
  res.json({ templates: BROADCAST_TEMPLATES });
});

app.post('/api/admin/broadcast', requireAdminSession, async (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: '本文を入力してください。' });

  try {
    const lineIds = (await getAuthorizedUsers()).filter((id) => id !== PHARMACIST_LINE_USER_ID);
    if (lineIds.length > 0) {
      await lineClient.multicast(lineIds, { type: 'text', text });
      lineIds.forEach((id) => addLineMessage(id, 'assistant', text));
    }

    const webIds = await listSessionIds();
    let webSent = 0;
    for (const id of webIds) {
      const session = await getSession(id);
      if (!session) {
        await removeSessionId(id); // 期限切れセッションを掃除
        continue;
      }
      if (!session.consented) continue;
      await sendToSession(id, { text });
      await addMessage(id, 'assistant', text);
      webSent++;
    }

    res.json({ ok: true, lineSent: lineIds.length, webSent });
  } catch (err) {
    console.error('一斉送信エラー（コンソール）:', err);
    res.status(500).json({ error: '一斉送信できませんでした。' });
  }
});

app.delete('/api/admin/patients/:id', requireAdminSession, async (req, res) => {
  const target = req.params.id;

  try {
    if (target.startsWith('web:')) {
      // セッションが消えると紐づけの参照先が失われるため、先に解除しておく
      // （解除時にお薬手帳の内容はweb側にコピーされるので、内容は失われない）
      await unlinkBooks(target).catch(() => {});
      await deleteSession(target.slice(4));
    } else {
      await revokeAuthorization(target);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('認証解除エラー（コンソール）:', err);
    res.status(500).json({ error: '認証解除できませんでした。' });
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
