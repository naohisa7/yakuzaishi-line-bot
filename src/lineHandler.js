const { enhanceImageToBase64 } = require('./imageEnhancer');
const { askClaude } = require('./claudeHandler');
const { addMessage, getHistory, clearHistory } = require('./conversationManager');
const { isAuthorized, authorize, getAuthorizedUsers } = require('./authManager');
const { markAwaitingFeedback, isAwaitingFeedback, clearAwaitingFeedback } = require('./feedbackManager');
const { recordFeedback, getRecentFeedback } = require('./feedbackLogManager');
const BROADCAST_TEMPLATES = require('./broadcastTemplates');
const { generateLinkCode, resolveLinkCode, linkPerson, getAllLinkedPeople } = require('./caregiverManager');
const { markPendingConsent, isPendingConsent, getPendingConsent, clearPendingConsent } = require('./consentManager');
const { PRIVACY_POLICY_TEXT } = require('./privacyPolicy');
const { startReply, getReplyTarget, clearReply } = require('./replyManager');
const { setPendingBroadcast, getPendingBroadcast, clearPendingBroadcast } = require('./pendingBroadcastManager');
const { getPasscode, setPasscode } = require('./passcodeManager');
const {
  getPharmacist,
  getPharmacistByAuthCode,
  getPharmacistByLineUserId,
  listPharmacists,
  addPharmacist,
  updatePharmacist,
  setAuthCode,
  setPassword: setPharmacistPassword,
  removePharmacist,
} = require('./pharmacistManager');
const { assignPharmacist } = require('./patientAssignmentManager');
const { notifyPharmacistsForPatient } = require('./pharmacistNotifier');
const {
  setPharmacistName,
  addArticle,
  getArticles,
  findArticleByIdPrefix,
  deleteArticle,
} = require('./contentManager');
const { getSession: getWebSession, listSessionIds, removeSessionId } = require('./webSessionManager');
const { addMessage: addWebMessage } = require('./webConversationManager');
const { sendToSession } = require('./wsManager');
const {
  getMedications,
  addMedication,
  removeMedication,
  isPharmacistSource,
  SOURCE_PHOTO,
} = require('./medicationRecordManager');
const { generateVideoCallLink } = require('./videoCallLink');
const { formatPatientMessages } = require('./escalationSummary');
const medicationEntry = require('./lineMedicationEntry');
const {
  generateLinkCode: generateMedicationLinkCode,
  getLinkedWebKey,
} = require('./medicationBookLinkManager');
const { setAdminPasscode } = require('./adminPasscodeManager');

const PHARMACIST_LINE_USER_ID = process.env.PHARMACIST_LINE_USER_ID;
const PHARMACIST_PHONE = process.env.PHARMACIST_PHONE || '（電話番号未設定）';
const PHARMACIST_PHONE_URI = PHARMACIST_PHONE.replace(/[^0-9+]/g, '');

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
 * 薬剤師への発信・ビデオ通話ボタン付きメッセージ
 * @param {string|null} videoLink - 同じ会話で発行済みのビデオ通話リンク（あれば同じ部屋に誘導するボタンを追加）
 */
function buildCallButtonMessage(videoLink) {
  const actions = [{ type: 'uri', label: '📞 薬剤師に電話する', uri: `tel:${PHARMACIST_PHONE_URI}` }];
  if (videoLink) {
    actions.push({ type: 'uri', label: '📹 ビデオ通話で相談する', uri: videoLink });
  }

  return {
    type: 'template',
    altText: `お急ぎの場合はこちらにお電話ください：${PHARMACIST_PHONE}`,
    template: {
      type: 'buttons',
      text: 'お急ぎの場合は、こちらから直接お電話・ビデオ通話でご相談いただけます',
      actions,
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
        {
          type: 'postback',
          label: '💬 チャットで返信する',
          data: `reply:${patientId}`,
          displayText: '💬 チャットで返信する',
        },
      ],
    },
  };
}

/**
 * 患者さんの表示名を取得（失敗時は「患者さん」）
 */
async function getPatientName(lineClient, userId) {
  try {
    const profile = await lineClient.getProfile(userId);
    return profile.displayName;
  } catch (_) {
    return '患者さん';
  }
}

/**
 * 返信対象（LINEの患者さん、またはホームページのセッション）の表示名を取得
 */
async function getReplyTargetName(lineClient, target) {
  if (target.startsWith('web:')) {
    const session = await getWebSession(target.slice(4));
    return session ? session.patientName : '患者さん（ホームページ）';
  }
  return getPatientName(lineClient, target);
}

/**
 * 「解決しなかった」が押されたことを薬剤師に即座に通知
 */
async function notifyUnresolved(lineClient, userId, videoLink) {
  const patientName = await getPatientName(lineClient, userId);
  const videoLine = videoLink ? `\n📹 ビデオ通話で参加する場合：\n${videoLink}` : '';

  await notifyPharmacistsForPatient(lineClient, `line:${userId}`, [
    {
      type: 'text',
      text: `❌【要フォロー】チャットボットで解決しなかったと回答
━━━━━━━━━━━━━━
👤 ${patientName}
━━━━━━━━━━━━━━
詳しい理由は追ってお伝えします。お急ぎであればこちらから先にチャットできます。${videoLine}`,
    },
    buildReplyButtonMessage(userId),
  ]);
}

/**
 * 「解決しなかった」の詳細フィードバックを薬剤師に通知
 */
async function notifyFeedback(lineClient, userId, feedbackText) {
  const patientName = await getPatientName(lineClient, userId);

  await recordFeedback(patientName, feedbackText);

  await notifyPharmacistsForPatient(lineClient, `line:${userId}`, [
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
 * 一斉送信前の最終確認メッセージ（誤送信防止のため、内容を必ず表示してから送信させる）
 */
function buildBroadcastConfirmMessage(text) {
  return {
    type: 'text',
    text: `📢 以下の内容を一斉送信します。よろしいですか？\n━━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━━`,
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '送信する', text: '送信する' } },
        { type: 'action', action: { type: 'message', label: 'キャンセル', text: 'キャンセル' } },
      ],
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
        action: {
          type: 'postback',
          label: names[i].slice(0, 20),
          data: `reply:${id}`,
          displayText: `${names[i]}さんに返信`,
        },
      })),
    },
  };
}

/**
 * 認証済み患者さん（薬剤師自身を除く）へ一斉送信
 * LINE経由・ホームページ経由どちらの患者さんにも届ける
 */
async function broadcastToPatients(lineClient, text) {
  const lineRecipients = (await getAuthorizedUsers()).filter((id) => id !== PHARMACIST_LINE_USER_ID);
  if (lineRecipients.length > 0) {
    await lineClient.multicast(lineRecipients, { type: 'text', text });
  }

  const webIds = await listSessionIds();
  let webCount = 0;
  for (const id of webIds) {
    const session = await getWebSession(id);
    if (!session) {
      await removeSessionId(id); // 期限切れセッションを掃除
      continue;
    }
    if (!session.consented) continue;
    await sendToSession(id, { text });
    await addWebMessage(id, 'assistant', text);
    webCount++;
  }

  const count = lineRecipients.length + webCount;
  return { sent: count > 0, count };
}

/**
 * 保存済みのお薬手帳を整形して表示用メッセージにする
 * 薬剤師が作成した手帳と、患者さんご自身の手帳は分けて表示する
 */
function formatMedicationList(entries) {
  if (entries.length === 0) {
    return 'まだお薬手帳に登録がありません。「お薬手帳に登録」と送っていただくと、お飲みになっているお薬を検索して登録できます。お薬の写真を送っていただいた場合も、確認できたものは記録されます。';
  }

  const toLines = (list) =>
    list
      .map((entry, i) => {
        const date = new Date(entry.recordedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
        return `${i + 1}. ${entry.name}（${date}登録）`;
      })
      .join('\n');

  const byPharmacist = entries.filter((e) => isPharmacistSource(e.source));
  const byPatient = entries.filter((e) => !isPharmacistSource(e.source));

  const sections = [];
  if (byPharmacist.length > 0) {
    sections.push(`💊 担当薬剤師が登録したお薬\n━━━━━━━━━━━━━━\n${toLines(byPharmacist)}`);
  }
  if (byPatient.length > 0) {
    sections.push(`✍️ ご自身で登録したお薬\n━━━━━━━━━━━━━━\n${toLines(byPatient)}`);
  }

  const note =
    byPatient.length > 0
      ? '\n\nご自身で登録したお薬を削除する場合は「お薬手帳から削除:薬品名」と送信してください。（薬剤師が登録したお薬は削除できません）'
      : '\n\n担当薬剤師が登録したお薬は、患者さんご自身では削除できません。';

  return `📋 お薬手帳\n\n${sections.join('\n\n')}${note}`;
}

/**
 * 特殊コマンドの処理
 * @returns {Promise<object[]|null>} コマンドへの返信メッセージ配列 or null（通常メッセージ）
 */
async function handleSpecialCommands(text, userId) {
  const trimmed = text.trim();

  if (trimmed === 'リセット' || trimmed === 'reset') {
    clearHistory(userId);
    return [{ type: 'text', text: '会話履歴をリセットしました。新しいご相談をどうぞ😊' }];
  }

  if (trimmed === 'お薬手帳を見る') {
    const entries = await getMedications(`line:${userId}`);
    const linkedWeb = await getLinkedWebKey(`line:${userId}`);
    const syncNote = linkedWeb
      ? '\n\n🔗 ホームページのお薬手帳と同期中です（どちらで登録しても同じ内容になります）。'
      : '';
    return [{ type: 'text', text: formatMedicationList(entries) + syncNote }];
  }

  // ホームページのお薬手帳と同期するための連携コードを発行する
  if (trimmed === 'ホームページと連携' || trimmed === 'ホームページと同期') {
    const code = await generateMedicationLinkCode(`line:${userId}`);
    return [
      {
        type: 'text',
        text: `📋 お薬手帳をホームページと同期するためのコードです（10分間有効）。

【${code}】

ホームページの「お薬手帳」ページを開き、「LINEと連携する」欄にこのコードを入力してください。
連携すると、LINEとホームページのお薬手帳が1つにまとまり、どちらで登録しても同じ内容になります。`,
      },
    ];
  }

  const medicationDeleteMatch = trimmed.match(/^お薬手帳から削除[:：]\s*(.+)$/);
  if (medicationDeleteMatch) {
    const name = medicationDeleteMatch[1].trim();
    // 患者さんは、薬剤師が登録したお薬は削除できない
    const removed = await removeMedication(`line:${userId}`, name, 'patient');
    return [
      {
        type: 'text',
        text: removed
          ? `「${name}」をお薬手帳から削除しました。`
          : `「${name}」は削除できませんでした。担当薬剤師が登録したお薬、またはお薬手帳に無いお薬です。`,
      },
    ];
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
・「お薬手帳に登録」→ お薬を検索して登録
・「お薬手帳を見る」→ 登録済みのお薬一覧を表示
・「お薬手帳から削除:薬品名」→ 一覧から削除
・「ホームページと連携」→ お薬手帳をホームページと同期
・「ビデオ通話」→ 担当薬剤師とビデオ通話で相談

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
  return enhanceImageToBase64(Buffer.concat(chunks));
}

/**
 * 薬剤師への通知メッセージを生成
 * 直前の1件だけでは文脈が分からないため、会話履歴に残っている
 * 患者さんの発言を時系列ですべて載せる（履歴は直近約5往復に丸め済み）
 */
async function buildEscalationMessage(lineClient, userId, userMessage, videoLink, history) {
  const patientName = await getPatientName(lineClient, userId);
  const videoLine = videoLink ? `\n📹 ビデオ通話で参加する場合：\n${videoLink}` : '';
  const messagesSummary = formatPatientMessages(history) || userMessage;

  return [
    {
      type: 'text',
      text: `🔔【要対応】かかりつけ患者さんから相談
━━━━━━━━━━━━━━
👤 ${patientName}
━━━━━━━━━━━━━━
💬 ご相談の流れ（患者さんの発言）：
${messagesSummary}
━━━━━━━━━━━━━━
⚠️ チャットボットでは対応が難しい内容です。${videoLine}`,
    },
    buildReplyButtonMessage(userId),
  ];
}

/**
 * メインのイベントハンドラ
 */
async function handleEvent(event, lineClient) {
  if (event.type === 'postback') {
    const postbackUserId = event.source.userId;

    // お薬手帳の登録中に、候補ボタン・登録ボタンが押された場合（患者さん・薬剤師 共通）
    const medicationReply = await medicationEntry.handlePostback(postbackUserId, event.postback.data);
    if (medicationReply) {
      return lineClient.replyMessage(event.replyToken, medicationReply);
    }

    // 薬剤師がボタンからチャット返信を開始する場合（登録済みの薬剤師なら誰でも）
    const isPharmacistPostback =
      (!!PHARMACIST_LINE_USER_ID && postbackUserId === PHARMACIST_LINE_USER_ID) ||
      !!(await getPharmacistByLineUserId(postbackUserId));
    if (isPharmacistPostback) {
      const match = event.postback.data.match(/^reply:(U[0-9a-f]{32}|web:[0-9a-f-]{36})$/);
      if (match) {
        const target = match[1];
        startReply(postbackUserId, target);
        const patientName = await getReplyTargetName(lineClient, target);
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: `🟢【返信モード中：${patientName}さん】\nここから送るメッセージはすべて${patientName}さんに届きます。\n\n・「お薬手帳に登録」→ ${patientName}さんのお薬手帳にお薬を登録\n・「終了」→ 返信モードを終了`,
        });
      }
    }
    return;
  }

  // テキスト・画像メッセージ以外は無視
  if (event.type !== 'message' || (event.message.type !== 'text' && event.message.type !== 'image')) {
    return;
  }

  const userId = event.source.userId;
  const isImage = event.message.type === 'image';
  const userMessage = isImage ? null : event.message.text;

  // この送信者が登録済みの薬剤師本人かどうか。
  // isOwner … 環境変数で指定された元々の管理者（1人）。roster・セキュリティ系コマンドはこの人だけ。
  // isPharmacistUser … 名簿に登録された薬剤師全員（返信モード・患者一覧・エスカレーション受信が使える）。
  const isOwner = !!PHARMACIST_LINE_USER_ID && userId === PHARMACIST_LINE_USER_ID;
  const isPharmacistUser = isOwner || !!(await getPharmacistByLineUserId(userId));

  // -2. お薬手帳の登録中に写真が送られたら、そこから薬品名を読み取って登録予定に積む
  //     （患者さん・薬剤師 共通。AIチャットや患者さんへの転送より前に処理しないと横取りされる）
  if (isImage) {
    const imageBase64 = await fetchImageBase64(lineClient, event.message.id);
    const medicationReply = await medicationEntry.handleImage(userId, imageBase64);
    if (medicationReply) {
      return lineClient.replyMessage(event.replyToken, medicationReply);
    }
    // 登録中でなければ、これまでどおりAIチャットに流す（下でもう一度取得しない）
    event.__imageBase64 = imageBase64;
  }

  // -1. 薬剤師からのコマンド（返信モード・お薬手帳登録・患者一覧・一斉送信・記事管理 等）
  if (!isImage && isPharmacistUser) {
    const trimmedAdminMessage = userMessage.trim();

    // お薬手帳の登録中は、その入力（検索語・番号）を最優先で処理する
    // （返信モード中に始めるため、患者さんへの転送より前に判定しないと横取りされてしまう）
    const medicationReply = await medicationEntry.handleText(userId, trimmedAdminMessage);
    if (medicationReply) {
      return lineClient.replyMessage(event.replyToken, medicationReply);
    }

    // 返信モード中は、次のメッセージをそのまま患者さんに転送する（「終了」まで継続・最優先で処理）
    const replyTarget = getReplyTarget(userId);
    if (replyTarget) {
      const replyPatientName = await getReplyTargetName(lineClient, replyTarget);

      // 返信モード中の患者さんのお薬手帳に登録する
      if (trimmedAdminMessage === medicationEntry.START_COMMAND) {
        const targetKey = replyTarget.startsWith('web:') ? replyTarget : `line:${replyTarget}`;
        const messages = await medicationEntry.start(userId, {
          targetKey,
          targetName: replyPatientName,
          isPharmacist: true,
        });
        return lineClient.replyMessage(event.replyToken, messages);
      }

      if (trimmedAdminMessage === '終了' || trimmedAdminMessage === 'キャンセル') {
        clearReply(userId);
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: `🔴 ${replyPatientName}さんへの返信モードを終了しました。`,
        });
      }

      if (trimmedAdminMessage === 'ビデオ通話') {
        const videoLink = generateVideoCallLink();
        const videoText = `📹 担当薬剤師からビデオ通話のご案内です\n下記のリンクをタップして参加してください。\n${videoLink}`;
        if (replyTarget.startsWith('web:')) {
          await sendToSession(replyTarget.slice(4), { text: videoText });
        } else {
          await lineClient.pushMessage(replyTarget, { type: 'text', text: videoText });
        }
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: `📹 ${replyPatientName}さんにビデオ通話リンクを送信しました。\nあなたも参加する場合はこちら：\n${videoLink}\n\n🟢 返信モード継続中（終了するときは「終了」と送信）`,
        });
      }

      const replyText = `💊 担当薬剤師からの返信\n━━━━━━━━━━━━━━\n${userMessage}`;
      if (replyTarget.startsWith('web:')) {
        await sendToSession(replyTarget.slice(4), { text: replyText });
      } else {
        await lineClient.pushMessage(replyTarget, { type: 'text', text: replyText });
      }
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `✅ ${replyPatientName}さんに送信しました。\n🟢 返信モード継続中（終了するときは「終了」と送信）`,
      });
    }

    // 一斉送信の内容確認待ち中は、確定・キャンセルの返答を最優先で処理する（誤送信防止）
    const pendingBroadcastText = getPendingBroadcast(userId);
    if (pendingBroadcastText) {
      if (trimmedAdminMessage === '送信する') {
        clearPendingBroadcast(userId);
        const result = await broadcastToPatients(lineClient, pendingBroadcastText);
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: result.sent
            ? `${result.count}名の患者さんに一斉送信しました。`
            : '認証済みの患者さんがまだいないため、送信できませんでした。',
        });
      }

      if (trimmedAdminMessage === 'キャンセル') {
        clearPendingBroadcast(userId);
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: '一斉送信をキャンセルしました。',
        });
      }

      // 「送信する」「キャンセル」以外が来た場合は、確認待ちのまま再度確認メッセージを表示する
      return lineClient.replyMessage(event.replyToken, buildBroadcastConfirmMessage(pendingBroadcastText));
    }

    // 「患者一覧」で特定の患者さんを選んでチャットを開始
    if (trimmedAdminMessage === '患者一覧') {
      return lineClient.replyMessage(event.replyToken, await buildPatientListMessage(lineClient));
    }

    // 「改善要望一覧」で「解決しなかった」際の改善点の記録を閲覧
    if (trimmedAdminMessage === '改善要望一覧') {
      const entries = await getRecentFeedback(10);
      if (entries.length === 0) {
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: 'まだ記録された改善要望はありません。',
        });
      }

      const listText = entries
        .map((entry, i) => {
          const date = new Date(entry.recordedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
          return `${i + 1}. 👤${entry.patientName}（${date}）\n${entry.feedbackText}`;
        })
        .join('\n━━━━━━━━━━━━━━\n');

      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `📋 直近の改善要望（新しい順・最大10件）\n━━━━━━━━━━━━━━\n${listText}`,
      });
    }

    // 「認証コード変更:新しいコード」で薬剤師#1の患者向け認証コードを変更（管理者のみ）
    const passcodeChangeMatch = trimmedAdminMessage.match(/^認証コード変更[:：]\s*(\S+)$/);
    if (isOwner && passcodeChangeMatch) {
      const code = passcodeChangeMatch[1];
      await setPasscode(code);
      const [first] = await listPharmacists();
      if (first) await setAuthCode(first.id, code);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `認証コードを更新しました。\n新しいコード：${code}\n（ホームページも同じコードで認証されます）`,
      });
    }

    // 「管理者パスワード変更:新しいパスワード」で薬剤師#1のログインパスワードを変更（管理者のみ）
    const adminPasscodeChangeMatch = trimmedAdminMessage.match(/^管理者パスワード変更[:：]\s*(\S+)$/);
    if (isOwner && adminPasscodeChangeMatch) {
      await setAdminPasscode(adminPasscodeChangeMatch[1]);
      const [first] = await listPharmacists();
      if (first) await setPharmacistPassword(first.id, adminPasscodeChangeMatch[1]);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `薬剤師専用ページのパスワードを更新しました。\n新しいパスワード：${adminPasscodeChangeMatch[1]}`,
      });
    }

    // 「薬剤師名変更:氏名」でお薬手帳ページに表示するかかりつけ薬剤師名を更新（管理者のみ）
    const pharmacistNameMatch = trimmedAdminMessage.match(/^薬剤師名変更[:：]\s*(.+)$/);
    if (isOwner && pharmacistNameMatch) {
      const name = pharmacistNameMatch[1].trim();
      await setPharmacistName(name);
      const [first] = await listPharmacists();
      if (first) await updatePharmacist(first.id, { name });
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `かかりつけ薬剤師名を更新しました。\n新しい名前：${name}\n（ホームページの「お薬手帳」ページに反映されます）`,
      });
    }

    // ── 薬剤師名簿の管理（管理者のみ）──

    // 「薬剤師追加:氏名」で薬剤師を追加
    const pharmacistAddMatch = trimmedAdminMessage.match(/^薬剤師追加[:：]\s*(.+)$/);
    if (isOwner && pharmacistAddMatch) {
      const name = pharmacistAddMatch[1].trim();
      const p = await addPharmacist(name);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `薬剤師「${name}」を追加しました。\nID：${p.id}\n\n続けて設定してください：\n・「薬剤師コード:${p.id} 認証コード」（患者さん用）\n・「薬剤師パスワード:${p.id} パスワード」（ログイン用）\n・本人のLINEから「薬剤師LINE連携:${p.id}」（通知の受け取り用）`,
      });
    }

    // 「薬剤師一覧」で名簿・各自の設定状況を確認
    if (isOwner && trimmedAdminMessage === '薬剤師一覧') {
      const list = await listPharmacists();
      if (list.length === 0) {
        return lineClient.replyMessage(event.replyToken, { type: 'text', text: 'まだ薬剤師が登録されていません。「薬剤師追加:氏名」で追加してください。' });
      }
      const listText = list
        .map((p) => {
          const code = p.patientAuthCode ? `認証コード:${p.patientAuthCode}` : '認証コード:未設定';
          const pass = p.passwordHash ? 'パスワード:設定済' : 'パスワード:未設定';
          const line = p.lineUserId ? 'LINE:連携済' : 'LINE:未連携';
          return `👤 ${p.name}\nID:${p.id}\n${code} / ${pass} / ${line}`;
        })
        .join('\n━━━━━━━━━━━━━━\n');
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `👥 薬剤師一覧\n━━━━━━━━━━━━━━\n${listText}`,
      });
    }

    // 「薬剤師コード:ID 認証コード」で患者向け認証コードを設定
    const pharmacistCodeMatch = trimmedAdminMessage.match(/^薬剤師コード[:：]\s*(\S+)\s+(\S+)$/);
    if (isOwner && pharmacistCodeMatch) {
      const result = await setAuthCode(pharmacistCodeMatch[1], pharmacistCodeMatch[2]);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: result.ok
          ? `認証コードを設定しました。\nこのコードで認証した患者さんが、この薬剤師の担当になります。`
          : result.message,
      });
    }

    // 「薬剤師パスワード:ID パスワード」でログインパスワードを設定
    const pharmacistPassMatch = trimmedAdminMessage.match(/^薬剤師パスワード[:：]\s*(\S+)\s+(\S+)$/);
    if (isOwner && pharmacistPassMatch) {
      const ok = await setPharmacistPassword(pharmacistPassMatch[1], pharmacistPassMatch[2]);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: ok ? 'ログインパスワードを設定しました。' : '該当の薬剤師IDが見つかりませんでした。',
      });
    }

    // 「薬剤師削除:ID」で薬剤師を名簿から削除
    const pharmacistDeleteMatch = trimmedAdminMessage.match(/^薬剤師削除[:：]\s*(\S+)$/);
    if (isOwner && pharmacistDeleteMatch) {
      const result = await removePharmacist(pharmacistDeleteMatch[1]);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: result.ok ? `薬剤師「${result.name}」を名簿から削除しました。` : result.message,
      });
    }

    // 「記事追加:タイトル\n本文」でお薬についての記事を投稿
    const articleAddMatch = trimmedAdminMessage.match(/^記事追加[:：]([^\n]+)\n([\s\S]+)$/);
    if (articleAddMatch) {
      const title = articleAddMatch[1].trim();
      const body = articleAddMatch[2].trim();
      const article = await addArticle(title, body);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `記事を投稿しました😊\nタイトル：${title}\nID：${article.id.slice(0, 8)}\n\nホームページの「記事」一覧に反映されています。`,
      });
    }

    // 「記事一覧」で投稿済みの記事を確認
    if (trimmedAdminMessage === '記事一覧') {
      const articles = await getArticles();
      if (articles.length === 0) {
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: 'まだ記事が投稿されていません。',
        });
      }
      const listText = articles
        .map((a, i) => `${i + 1}. ${a.title}（ID: ${a.id.slice(0, 8)}）`)
        .join('\n');
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `📝 投稿済みの記事一覧\n━━━━━━━━━━━━━━\n${listText}\n\n削除する場合は「記事削除:ID」と送信してください。`,
      });
    }

    // 「記事削除:ID」で記事を削除
    const articleDeleteMatch = trimmedAdminMessage.match(/^記事削除[:：]\s*(\S+)$/);
    if (articleDeleteMatch) {
      const target = await findArticleByIdPrefix(articleDeleteMatch[1]);
      if (!target) {
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: '該当するIDの記事が見つかりませんでした。「記事一覧」でIDを確認してください。',
        });
      }
      await deleteArticle(target.id);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `記事「${target.title}」を削除しました。`,
      });
    }

    // 「一斉送信」だけを送った場合は定型文の選択メニューを表示
    if (trimmedAdminMessage === '一斉送信') {
      return lineClient.replyMessage(event.replyToken, buildBroadcastTemplateMenu());
    }

    // メニューから定型文ラベルが選択された場合（誤送信防止のため、即送信せず確認を挟む）
    const matchedTemplate = BROADCAST_TEMPLATES.find((tpl) => tpl.label === trimmedAdminMessage);
    if (matchedTemplate) {
      setPendingBroadcast(userId, matchedTemplate.text);
      return lineClient.replyMessage(event.replyToken, buildBroadcastConfirmMessage(matchedTemplate.text));
    }

    // 「一斉送信：本文」の形式で自由文を送信（こちらも確認を挟む）
    const broadcastMatch = userMessage.match(/^一斉送信[:：]\s*([\s\S]+)$/);
    if (broadcastMatch) {
      const text = broadcastMatch[1].trim();
      setPendingBroadcast(userId, text);
      return lineClient.replyMessage(event.replyToken, buildBroadcastConfirmMessage(text));
    }
  }

  // 薬剤師本人が、自分のLINEを名簿に連携する（未認証でも受け付ける）
  // ※ 追加直後の薬剤師はまだ名簿にLINE未連携で「患者」として扱われるため、認証チェックより前に処理する。
  //    IDは管理者から本人へ直接共有される（UUIDのため推測は困難）。
  if (!isImage) {
    const pharmacistLinkMatch = userMessage.trim().match(/^薬剤師LINE連携[:：]\s*(\S+)$/);
    if (pharmacistLinkMatch) {
      const target = await getPharmacist(pharmacistLinkMatch[1]);
      if (!target) {
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: '該当の薬剤師IDが見つかりません。IDをご確認ください。',
        });
      }
      await updatePharmacist(target.id, { lineUserId: userId });
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `${target.name}さんのLINEを連携しました😊\n今後、担当患者さんのエスカレーション通知が届き、返信モードなどもご利用いただけます。`,
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
  const currentPasscode = await getPasscode();
  const alreadyAuthorized = await isAuthorized(userId);
  if (currentPasscode && !alreadyAuthorized) {
    // 同意待ちの場合の応答
    if (isPendingConsent(userId)) {
      const trimmedConsent = !isImage ? userMessage.trim() : '';

      if (trimmedConsent === '同意する') {
        const pending = getPendingConsent(userId);
        clearPendingConsent(userId);
        await authorize(userId);
        // 認証コードで解決した薬剤師を、この患者さんの担当として紐づける
        if (pending && pending.pharmacistId) {
          await assignPharmacist(`line:${userId}`, pending.pharmacistId);
        }
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

    if (!isImage) {
      // 入力されたコードが、どの薬剤師の認証コードか解決する（＝担当薬剤師）
      const pharmacist = await getPharmacistByAuthCode(userMessage.trim());
      if (pharmacist) {
        markPendingConsent(userId, { pharmacistId: pharmacist.id });
        return lineClient.replyMessage(event.replyToken, [
          { type: 'text', text: PRIVACY_POLICY_TEXT },
          buildConsentPrompt(),
        ]);
      }
    }

    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: 'このアカウントはかかりつけ患者さま専用のご相談窓口です。\n担当薬剤師からお伝えした認証コードを送信してください。',
    });
  }

  // 画像以外（テキスト）の場合のみ、特殊コマンド・フィードバックボタンを処理
  if (!isImage) {
    // 0.5 お薬手帳の登録中は、その入力（検索語・番号）を最優先で処理する
    //     （AIチャットに流れてしまわないよう、特殊コマンドより前に判定する）
    const medicationReply = await medicationEntry.handleText(userId, userMessage);
    if (medicationReply) {
      return lineClient.replyMessage(event.replyToken, medicationReply);
    }

    if (userMessage.trim() === medicationEntry.START_COMMAND) {
      const messages = await medicationEntry.start(userId, {
        targetKey: `line:${userId}`,
        targetName: await getPatientName(lineClient, userId),
        isPharmacist: false,
      });
      return lineClient.replyMessage(event.replyToken, messages);
    }

    // 1. 特殊コマンドチェック
    const commandReply = await handleSpecialCommands(userMessage, userId);
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

    if (trimmedMessage === 'ビデオ通話') {
      const videoLink = generateVideoCallLink();
      const patientName = await getPatientName(lineClient, userId);
      await notifyPharmacistsForPatient(lineClient, `line:${userId}`, [
        {
          type: 'text',
          text: `📹【ビデオ通話希望】${patientName}さんがビデオ通話を希望しています
━━━━━━━━━━━━━━
参加はこちら：
${videoLink}`,
        },
        buildReplyButtonMessage(userId),
      ]);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `📹 担当薬剤師にビデオ通話をご案内しました。\n下記のリンクから参加してお待ちください：\n${videoLink}`,
      });
    }

    if (trimmedMessage === '解決しなかった') {
      markAwaitingFeedback(userId);
      const videoLink = generateVideoCallLink();
      await notifyUnresolved(lineClient, userId, videoLink);
      return lineClient.replyMessage(event.replyToken, [
        {
          type: 'text',
          text: '申し訳ありません。今後の改善のため、どのような点が分かりにくかった・不十分だったか教えていただけますか？',
        },
        buildCallButtonMessage(videoLink),
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
      // お薬手帳の登録チェックで取得済みなら使い回す（LINEから二重にダウンロードしない）
      const imageBase64 = event.__imageBase64 || (await fetchImageBase64(lineClient, event.message.id));
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: 'この薬、または お薬手帳の写真です。商品名、ジェネリックであればメーカー名、市販薬であれば有効成分、用法用量を確認して教えてください。一包化された裸錠の場合は、薬剤名を断定せず、見えている刻印や特徴を伝えた上で薬剤師に確認してもらってください。' },
      ];
    } else {
      userContent = userMessage;
    }
    addMessage(userId, 'user', userContent);
    const history = getHistory(userId);

    // 5. Claudeに問い合わせ（お薬手帳に記録済みの薬があれば文脈として渡す）
    const knownMedications = await getMedications(`line:${userId}`);
    const { message, needsEscalation, savedDrugs } = await askClaude(history, knownMedications);

    // 6. 会話履歴にアシスタントの返信を追加
    addMessage(userId, 'assistant', message);

    // 6.5 写真から確実に特定できた薬があればお薬手帳に記録
    //     （テキストで名前を言われただけのものは askClaude 側で除外済み）
    for (const drugName of savedDrugs) {
      await addMedication(`line:${userId}`, drugName, SOURCE_PHOTO);
    }

    // 7. 患者さんへ返信
    // 対応困難なケースは電話・ビデオ通話ボタンを、それ以外は解決確認のクイックリプライを添える
    let replyMessages;
    const escalationVideoLink = needsEscalation ? generateVideoCallLink() : null;
    if (needsEscalation) {
      replyMessages = [{ type: 'text', text: message }, buildCallButtonMessage(escalationVideoLink)];
    } else {
      replyMessages = [withSolvedQuickReply({ type: 'text', text: message })];
    }
    await lineClient.replyMessage(event.replyToken, replyMessages);

    // 8. エスカレーションが必要な場合、担当薬剤師に通知（未割り当ては全薬剤師へ）
    if (needsEscalation) {
      const escalationMsg = await buildEscalationMessage(
        lineClient,
        userId,
        isImage ? '（お薬・お薬手帳の写真が送信されました）' : userMessage,
        escalationVideoLink,
        history
      );
      await notifyPharmacistsForPatient(lineClient, `line:${userId}`, escalationMsg);
      console.log(`[ESCALATE] userId: ${userId} の相談を担当薬剤師に通知しました`);

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
      buildCallButtonMessage(generateVideoCallLink()),
    ]);
  }
}

module.exports = { handleEvent };
