const sharp = require('sharp');
const { askClaude } = require('./claudeHandler');
const { addMessage, getHistory, clearHistory } = require('./conversationManager');
const { isAuthorized, authorize, getAuthorizedUsers } = require('./authManager');
const { markAwaitingFeedback, isAwaitingFeedback, clearAwaitingFeedback } = require('./feedbackManager');
const BROADCAST_TEMPLATES = require('./broadcastTemplates');
const { generateLinkCode, resolveLinkCode, linkPerson, getAllLinkedPeople } = require('./caregiverManager');
const { markPendingConsent, isPendingConsent, clearPendingConsent } = require('./consentManager');
const { PRIVACY_POLICY_TEXT } = require('./privacyPolicy');
const { startReply, getReplyTarget, clearReply } = require('./replyManager');

const PHARMACIST_LINE_USER_ID = process.env.PHARMACIST_LINE_USER_ID;
const PHARMACIST_PHONE = process.env.PHARMACIST_PHONE || '（電話番号未設定）';
const PHARMACIST_PHONE_URI = PHARMACIST_PHONE.replace(/[^0-9+]/g, '');
const PATIENT_PASSCODE = process.env.PATIENT_PASSCODE;

/**
 * プライバシーポリシーへの同意確認ボタン
 */
function buildConsentPrompt() {
  return {
    type: 'template',
    altText: '上記の内容にご同意いただける場合は「同意する」を選んでください',
    template: {
      type: 'buttons',
      text: '上記の内容にご同意いただけますか？',
      actions: [
        { type: 'message', label: '同意する', text: '同意する' },
        { type: 'message', label: '同意しない', text: '同意しない' },
      ],
    },
  };
}

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
 * メッセージに「解決した／しなかった」のクイックリプライを付与
 */
function withSolvedQuickReply(message) {
  return {
    ...message,
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '✅ 解決した', text: '解決した' } },
        { type: 'action', action: { type: 'message', label: '❌ 解決しなかった', text: '解決しなかった' } },
      ],
    },
  };
}

/**
 * 患者さんにチャットで直接返信するためのボタン
 */
function buildReplyButtonMessage(patientId) {
  return {
    type: 'template',
    altText: 'この患者さんにチャットで直接返信できます',
    template: {
      type: 'buttons',
      text: '電話の代わりに、チャットで直接返信することもできます',
      actions: [
        { type: 'message', label: '💬 チャットで返信する', text: `返信:${patientId}` },
      ],
    },
  };
}

/**
 * 「解決しなかった」が押されたことを薬剤師に即座に通知
 */
async function notifyUnresolved(lineClient, userId) {
  if (!PHARMACIST_LINE_USER_ID) return;

  let patientName = '患者さん';
  try {
    const profile = await lineClient.getProfile(userId);
    patientName = profile.displayName;
  } catch (_) {}

  await lineClient.pushMessage(PHARMACIST_LINE_USER_ID, [
    {
      type: 'text',
      text: `❌【要フォロー】チャットボットで解決しなかったと回答
━━━━━━━━━━━━━━
👤 ${patientName}
━━━━━━━━━━━━━━
詳しい理由は追ってお伝えします。お急ぎであればこちらから先にチャットできます。`,
    },
    buildReplyButtonMessage(userId),
  ]);
}

/**
 * 「解決しなかった」の詳細フィードバックを薬剤師に通知
 */
async function notifyFeedback(lineClient, userId, feedbackText) {
  if (!PHARMACIST_LINE_USER_ID) return;

  let patientName = '患者さん';
  try {
    const profile = await lineClient.getProfile(userId);
    patientName = profile.displayName;
  } catch (_) {}

  await lineClient.pushMessage(PHARMACIST_LINE_USER_ID, [
    {
      type: 'text',
      text: `📝【フィードバック詳細】チャットボットで解決できなかったとの回答
━━━━━━━━━━━━━━
👤 ${patientName}
━━━━━━━━━━━━━━
💬 いただいた内容：
${feedbackText}`,
    },
    buildReplyButtonMessage(userId),
  ]);
}

/**
 * 一斉送信の定型文選択メニュー
 */
function buildBroadcastTemplateMenu() {
  return {
    type: 'text',
    text: '送信する定型文を選んでください👇\n（自由文を送りたい場合は「一斉送信：本文」の形式で送信してください）',
    quickReply: {
      items: BROADCAST_TEMPLATES.map((tpl) => ({
        type: 'action',
        action: { type: 'message', label: tpl.label, text: tpl.label },
      })),
    },
  };
}

/**
 * 患者さん一覧をクイックリプライで表示（選択すると返信モードに入る）
 */
async function buildPatientListMessage(lineClient) {
  const patientIds = (await getAuthorizedUsers()).filter((id) => id !== PHARMACIST_LINE_USER_ID);

  if (patientIds.length === 0) {
    return { type: 'text', text: '認証済みの患者さんがまだいません。' };
  }

  const targetIds = patientIds.slice(0, 13);
  const names = await Promise.all(
    targetIds.map(async (id) => {
      try {
        const profile = await lineClient.getProfile(id);
        return profile.displayName;
      } catch (_) {
        return '（表示名不明）';
      }
    })
  );

  return {
    type: 'text',
    text: `チャットを送る患者さんを選んでください👇${patientIds.length > 13 ? `\n（先頭13名のみ表示、全${patientIds.length}名）` : ''}`,
    quickReply: {
      items: targetIds.map((id, i) => ({
        type: 'action',
        action: { type: 'message', label: names[i].slice(0, 20), text: `返信:${id}` },
      })),
    },
  };
}

/**
 * 認証済み患者さん（薬剤師自身を除く）へ一斉送信
 */
async function broadcastToPatients(lineClient, text) {
  const recipients = (await getAuthorizedUsers()).filter((id) => id !== PHARMACIST_LINE_USER_ID);
  if (recipients.length === 0) {
    return { sent: false, count: 0 };
  }
  await lineClient.multicast(recipients, { type: 'text', text });
  return { sent: true, count: recipients.length };
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
・「家族登録」→ ご家族と連携するための番号を発行
・「介護者登録」→ 介護者と連携するための番号を発行

🚨 緊急の場合
症状が重い場合はすぐに119番へ`,
      },
      buildCallButtonMessage(),
    ];
  }

  return null;
}

/**
 * LINEから画像コンテンツを取得しBase64に変換
 */
async function fetchImageBase64(lineClient, messageId) {
  const stream = await lineClient.getMessageContent(messageId);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const rawImage = Buffer.concat(chunks);

  // ぼやけた写真でも文字を読み取りやすいよう、シャープ化とコントラスト補正をかける
  const enhancedImage = await sharp(rawImage)
    .resize({ width: 2000, withoutEnlargement: true })
    .normalize()
    .sharpen({ sigma: 1.5 })
    .jpeg({ quality: 90 })
    .toBuffer();

  return enhancedImage.toString('base64');
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

  return [
    {
      type: 'text',
      text: `🔔【要対応】かかりつけ患者さんから相談
━━━━━━━━━━━━━━
👤 ${patientName}
━━━━━━━━━━━━━━
💬 相談内容：
${userMessage}
━━━━━━━━━━━━━━
⚠️ チャットボットでは対応が難しい内容です。`,
    },
    buildReplyButtonMessage(userId),
  ];
}

/**
 * メインのイベントハンドラ
 */
async function handleEvent(event, lineClient) {
  // テキスト・画像メッセージ以外は無視
  if (event.type !== 'message' || (event.message.type !== 'text' && event.message.type !== 'image')) {
    return;
  }

  const userId = event.source.userId;
  const isImage = event.message.type === 'image';
  const userMessage = isImage ? null : event.message.text;

  // -1. 薬剤師からの一斉送信コマンド（フォローアップ等）
  if (!isImage && PHARMACIST_LINE_USER_ID && userId === PHARMACIST_LINE_USER_ID) {
    const trimmedAdminMessage = userMessage.trim();

    // 返信モード中は、次のメッセージをそのまま患者さんに転送する（最優先で処理）
    const replyTarget = getReplyTarget(userId);
    if (replyTarget) {
      if (trimmedAdminMessage === 'キャンセル') {
        clearReply(userId);
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: '返信をキャンセルしました。',
        });
      }

      await lineClient.pushMessage(replyTarget, {
        type: 'text',
        text: `💊 担当薬剤師からの返信\n━━━━━━━━━━━━━━\n${userMessage}`,
      });
      clearReply(userId);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '患者さんに送信しました。',
      });
    }

    // エスカレーション通知のボタンから「返信:<患者のuserId>」が送られてきた場合
    const replyStartMatch = trimmedAdminMessage.match(/^返信:(U[0-9a-f]{32})$/);
    if (replyStartMatch) {
      startReply(userId, replyStartMatch[1]);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '返信モードに入りました。患者さんに送る内容を入力してください（中止する場合は「キャンセル」）。',
      });
    }

    // 「患者一覧」で特定の患者さんを選んでチャットを開始
    if (trimmedAdminMessage === '患者一覧') {
      return lineClient.replyMessage(event.replyToken, await buildPatientListMessage(lineClient));
    }

    // 「一斉送信」だけを送った場合は定型文の選択メニューを表示
    if (trimmedAdminMessage === '一斉送信') {
      return lineClient.replyMessage(event.replyToken, buildBroadcastTemplateMenu());
    }

    // メニューから定型文ラベルが選択された場合
    const matchedTemplate = BROADCAST_TEMPLATES.find((tpl) => tpl.label === trimmedAdminMessage);
    if (matchedTemplate) {
      const result = await broadcastToPatients(lineClient, matchedTemplate.text);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: result.sent
          ? `${result.count}名の患者さんに送信しました。`
          : '認証済みの患者さんがまだいないため、送信できませんでした。',
      });
    }

    // 「一斉送信：本文」の形式で自由文を送信
    const broadcastMatch = userMessage.match(/^一斉送信[:：]\s*([\s\S]+)$/);
    if (broadcastMatch) {
      const result = await broadcastToPatients(lineClient, broadcastMatch[1].trim());
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: result.sent
          ? `${result.count}名の患者さんに一斉送信しました。`
          : '認証済みの患者さんがまだいないため、送信できませんでした。',
      });
    }
  }

  // ご家族・介護者の連携コード確認（未認証でも受け付ける）
  if (!isImage && /^\d{6}$/.test(userMessage.trim())) {
    const resolved = await resolveLinkCode(userMessage.trim());
    if (resolved) {
      const { patientId, type } = resolved;
      await linkPerson(patientId, userId, type);
      await authorize(userId);
      const typeLabel = type === 'family' ? 'ご家族' : '介護者';
      try {
        await lineClient.pushMessage(patientId, {
          type: 'text',
          text: `${typeLabel}の方との連携が完了しました😊`,
        });
      } catch (_) {}
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '連携が完了しました😊\n今後、大事な通知が届くほか、通常のご相談もご利用いただけます。',
      });
    }
  }

  // 0. 認証チェック（かかりつけ患者さん以外は利用不可）
  const alreadyAuthorized = await isAuthorized(userId);
  if (PATIENT_PASSCODE && !alreadyAuthorized) {
    // 同意待ちの場合の応答
    if (isPendingConsent(userId)) {
      const trimmedConsent = !isImage ? userMessage.trim() : '';

      if (trimmedConsent === '同意する') {
        clearPendingConsent(userId);
        await authorize(userId);
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: '認証されました😊\nお薬について何でもご相談ください。',
        });
      }

      if (trimmedConsent === '同意しない') {
        clearPendingConsent(userId);
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: `同意いただけない場合、本サービスはご利用いただけません。\nご不明点があれば担当薬剤師までご連絡ください：${PHARMACIST_PHONE}`,
        });
      }

      return lineClient.replyMessage(event.replyToken, buildConsentPrompt());
    }

    if (!isImage && userMessage.trim() === PATIENT_PASSCODE) {
      markPendingConsent(userId);
      return lineClient.replyMessage(event.replyToken, [
        { type: 'text', text: PRIVACY_POLICY_TEXT },
        buildConsentPrompt(),
      ]);
    }

    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: 'このアカウントはかかりつけ患者さま専用のご相談窓口です。\n担当薬剤師からお伝えした認証コードを送信してください。',
    });
  }

  // 画像以外（テキスト）の場合のみ、特殊コマンド・フィードバックボタンを処理
  if (!isImage) {
    // 1. 特殊コマンドチェック
    const commandReply = handleSpecialCommands(userMessage, userId);
    if (commandReply) {
      return lineClient.replyMessage(event.replyToken, commandReply);
    }

    const trimmedMessage = userMessage.trim();

    // 2. 「解決した／しなかった」ボタンの処理
    if (trimmedMessage === '解決した') {
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: 'よかったです😊 また何かあればいつでもご相談ください。',
      });
    }

    if (trimmedMessage === '家族登録') {
      const code = await generateLinkCode(userId, 'family');
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `ご家族の方と連携するための番号です（10分間有効）。\n\n【${code}】\n\nこの番号をご家族にお伝えください。ご家族がこのアカウントを友だち追加し、この番号を送信すると連携が完了し、大事な通知が届くようになります。`,
      });
    }

    if (trimmedMessage === '介護者登録') {
      const code = await generateLinkCode(userId, 'caregiver');
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `介護者の方と連携するための番号です（10分間有効）。\n\n【${code}】\n\nこの番号を介護者の方にお伝えください。その方がこのアカウントを友だち追加し、この番号を送信すると連携が完了し、大事な通知が届くようになります。`,
      });
    }

    if (trimmedMessage === '解決しなかった') {
      markAwaitingFeedback(userId);
      await notifyUnresolved(lineClient, userId);
      return lineClient.replyMessage(event.replyToken, [
        {
          type: 'text',
          text: '申し訳ありません。今後の改善のため、どのような点が分かりにくかった・不十分だったか教えていただけますか？',
        },
        buildCallButtonMessage(),
      ]);
    }

    // 3. 「解決しなかった」の詳細フィードバック待ちの場合、このメッセージをフィードバックとして扱う
    if (isAwaitingFeedback(userId)) {
      clearAwaitingFeedback(userId);
      await notifyFeedback(lineClient, userId, userMessage);
      console.log(`[FEEDBACK] userId: ${userId} からのフィードバックを薬剤師に通知しました`);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '貴重なご意見をありがとうございました。今後の改善に活かします🙏',
      });
    }
  }

  try {
    // 4. 会話履歴にユーザーメッセージ（または画像）を追加
    let userContent;
    if (isImage) {
      const imageBase64 = await fetchImageBase64(lineClient, event.message.id);
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: 'この薬、または お薬手帳の写真です。商品名、ジェネリックであればメーカー名、市販薬であれば有効成分、用法用量を確認して教えてください。' },
      ];
    } else {
      userContent = userMessage;
    }
    addMessage(userId, 'user', userContent);
    const history = getHistory(userId);

    // 5. Claudeに問い合わせ
    const { message, needsEscalation } = await askClaude(history);

    // 6. 会話履歴にアシスタントの返信を追加
    addMessage(userId, 'assistant', message);

    // 7. 患者さんへ返信
    // 対応困難なケースは電話ボタンを、それ以外は解決確認のクイックリプライを添える
    let replyMessages;
    if (needsEscalation) {
      replyMessages = [{ type: 'text', text: message }, buildCallButtonMessage()];
    } else {
      replyMessages = [withSolvedQuickReply({ type: 'text', text: message })];
    }
    await lineClient.replyMessage(event.replyToken, replyMessages);

    // 8. エスカレーションが必要な場合、薬剤師に通知
    if (needsEscalation && PHARMACIST_LINE_USER_ID) {
      const escalationMsg = await buildEscalationMessage(
        lineClient,
        userId,
        isImage ? '（お薬・お薬手帳の写真が送信されました）' : userMessage
      );
      await lineClient.pushMessage(PHARMACIST_LINE_USER_ID, escalationMsg);
      console.log(`[ESCALATE] userId: ${userId} の相談を薬剤師に通知しました`);

      const linkedPeople = await getAllLinkedPeople(userId);
      if (linkedPeople.length > 0) {
        await lineClient.multicast(linkedPeople, {
          type: 'text',
          text: '🔔 ご家族の相談について、担当薬剤師が確認しております。必要に応じてご連絡いたしますので、少々お待ちください。',
        });
      }
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
