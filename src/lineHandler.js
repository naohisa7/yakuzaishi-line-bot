const { askClaude } = require('./claudeHandler');
const { addMessage, getHistory, clearHistory } = require('./conversationManager');
const { isAuthorized, authorize } = require('./authManager');

const PHARMACIST_LINE_USER_ID = process.env.PHARMACIST_LINE_USER_ID;
const PHARMACIST_PHONE = process.env.PHARMACIST_PHONE || '（電話番号未設定）';
const PHARMACIST_PHONE_URI = PHARMACIST_PHONE.replace(/[^0-9+]/g, '');
const PATIENT_PASSCODE = process.env.PATIENT_PASSCODE;

/**
 * 薬剤師への発信ボタン付きメッセージ
 */
function buildCallButtonMessage() {
  return {
    type: 'template',
    altText: `お急ぎの場合はこちらにお電話ください：${PHARMACIST_PHONE}`,
    template: {
      type: 'buttons',
      text: 'お急ぎの場合は、こちらから直接お電話いただけます',
      actions: [
        { type: 'uri', label: '📞 薬剤師に電話する', uri: `tel:${PHARMACIST_PHONE_URI}` },
      ],
    },
  };
}

/**
 * 特殊コマンドの処理
 * @returns {object[]|null} コマンドへの返信メッセージ配列 or null（通常メッセージ）
 */
function handleSpecialCommands(text, userId) {
  const trimmed = text.trim();

  if (trimmed === 'リセット' || trimmed === 'reset') {
    clearHistory(userId);
    return [{ type: 'text', text: '会話履歴をリセットしました。新しいご相談をどうぞ😊' }];
  }

  if (trimmed === 'ヘルプ' || trimmed === 'help') {
    return [
      {
        type: 'text',
        text: `【ご利用ガイド】

💊 お薬について何でもご相談ください
例：「薬を飲み忘れました」「副作用が心配です」

📋 特別なコマンド
・「リセット」→ 会話履歴を初期化
・「ヘルプ」→ このガイドを表示

🚨 緊急の場合
症状が重い場合はすぐに119番へ`,
      },
      buildCallButtonMessage(),
    ];
  }

  return null;
}

/**
 * 薬剤師への通知メッセージを生成
 */
async function buildEscalationMessage(lineClient, userId, userMessage) {
  let patientName = '患者さん';
  try {
    const profile = await lineClient.getProfile(userId);
    patientName = profile.displayName;
  } catch (_) {}

  return {
    type: 'text',
    text: `🔔【要対応】かかりつけ患者さんから相談
━━━━━━━━━━━━━━
👤 ${patientName}
━━━━━━━━━━━━━━
💬 相談内容：
${userMessage}
━━━━━━━━━━━━━━
⚠️ チャットボットでは対応が難しい内容です。LINEまたはお電話でご確認ください。`,
  };
}

/**
 * メインのイベントハンドラ
 */
async function handleEvent(event, lineClient) {
  // テキストメッセージ以外は無視
  if (event.type !== 'message' || event.message.type !== 'text') {
    return;
  }

  const userId = event.source.userId;
  const userMessage = event.message.text;

  // 0. 認証チェック（かかりつけ患者さん以外は利用不可）
  if (PATIENT_PASSCODE && !isAuthorized(userId)) {
    if (userMessage.trim() === PATIENT_PASSCODE) {
      authorize(userId);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '認証されました😊\nお薬について何でもご相談ください。',
      });
    }

    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: 'このアカウントはかかりつけ患者さま専用のご相談窓口です。\n担当薬剤師からお伝えした認証コードを送信してください。',
    });
  }

  // 1. 特殊コマンドチェック
  const commandReply = handleSpecialCommands(userMessage, userId);
  if (commandReply) {
    return lineClient.replyMessage(event.replyToken, commandReply);
  }

  try {
    // 2. 会話履歴にユーザーメッセージを追加
    addMessage(userId, 'user', userMessage);
    const history = getHistory(userId);

    // 3. Claudeに問い合わせ
    const { message, needsEscalation } = await askClaude(history);

    // 4. 会話履歴にアシスタントの返信を追加
    addMessage(userId, 'assistant', message);

    // 5. 患者さんへ返信（対応困難なケースは電話ボタンも添える）
    const replyMessages = [{ type: 'text', text: message }];
    if (needsEscalation) {
      replyMessages.push(buildCallButtonMessage());
    }
    await lineClient.replyMessage(event.replyToken, replyMessages);

    // 6. エスカレーションが必要な場合、薬剤師に通知
    if (needsEscalation && PHARMACIST_LINE_USER_ID) {
      const escalationMsg = await buildEscalationMessage(lineClient, userId, userMessage);
      await lineClient.pushMessage(PHARMACIST_LINE_USER_ID, escalationMsg);
      console.log(`[ESCALATE] userId: ${userId} の相談を薬剤師に通知しました`);
    }

  } catch (error) {
    console.error('メッセージ処理エラー:', error);

    // エラー時は患者さんに丁寧にお断りを返す
    await lineClient.replyMessage(event.replyToken, [
      { type: 'text', text: '申し訳ありません。現在システムの調子が良くありません。' },
      buildCallButtonMessage(),
    ]);
  }
}

module.exports = { handleEvent };
