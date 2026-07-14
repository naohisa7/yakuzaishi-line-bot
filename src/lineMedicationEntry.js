const { searchDrugs, MIN_QUERY_LENGTH } = require('./drugMaster');
const { addMedications, SOURCE_MANUAL, SOURCE_PHARMACIST } = require('./medicationRecordManager');
const {
  getEntry,
  startEntry,
  setCandidates,
  addPending,
  removePending,
  clearEntry,
} = require('./medicationEntryManager');

/**
 * LINEでのお薬手帳登録（患者さん・薬剤師 共通）
 *
 * ホームページの登録画面と同じ「3文字以上で検索 → 候補から選ぶ → 繰り返す →
 * まとめて登録」の流れを、LINEの会話とクイックリプライのボタンで再現する。
 *
 * 患者さんは自分のお薬手帳に（メーカー名なしの候補）、薬剤師は返信モード中の
 * 患者さんのお薬手帳に（メーカー名込みの候補）登録する。
 */

const START_COMMAND = 'お薬手帳に登録';
// 「終了」も含める。薬剤師は返信モード中にこの登録を始めるため、「終了」を検索語として
// 扱ってしまうと返信モードを抜けられなくなる（まず登録を抜け、もう一度送れば返信モードも抜ける）
const CANCEL_WORDS = ['やめる', 'キャンセル', '中止', '終了'];
const SAVE_WORDS = ['登録', '登録する'];

// クイックリプライは最大13個。候補10個＋「登録する」＋「やめる」で収まるようにする
const MAX_CANDIDATES = 10;
const QUICK_REPLY_LABEL_MAX = 20;

const POSTBACK_PICK = 'medpick';
const POSTBACK_SAVE = 'medsave';
const POSTBACK_CANCEL = 'medcancel';

/** クイックリプライのラベルは20文字までなので、長い薬品名は省略する */
function toLabel(name) {
  return name.length > QUICK_REPLY_LABEL_MAX
    ? `${name.slice(0, QUICK_REPLY_LABEL_MAX - 1)}…`
    : name;
}

function quickReplyItem(label, data, displayText) {
  return {
    type: 'action',
    action: { type: 'postback', label, data, displayText: displayText || label },
  };
}

/** 「登録する」「やめる」ボタン（登録予定が0件のときは登録ボタンを出さない） */
function controlItems(pendingCount) {
  const items = [];
  if (pendingCount > 0) {
    items.push(quickReplyItem(`✅ ${pendingCount}件を登録する`, POSTBACK_SAVE, '登録する'));
  }
  items.push(quickReplyItem('✖️ やめる', POSTBACK_CANCEL, 'やめる'));
  return items;
}

function pendingSummary(pending) {
  if (pending.length === 0) return '';
  const list = pending.map((name, i) => `${i + 1}. ${name}`).join('\n');
  return `\n\n📝 登録予定（${pending.length}件）\n${list}\n\n取り消す場合は「取消:番号」（例：取消:1）と送信してください。`;
}

function textMessage(text, quickReplyItems) {
  const message = { type: 'text', text };
  if (quickReplyItems && quickReplyItems.length > 0) {
    message.quickReply = { items: quickReplyItems };
  }
  return message;
}

/** 検索を促すメッセージ */
function promptMessage(session, lead) {
  const forWhom =
    session.source === SOURCE_PHARMACIST ? `【${session.targetName}さんのお薬手帳】\n` : '';
  const makerNote =
    session.source === SOURCE_PHARMACIST
      ? '（メーカー名込みの正式名称で登録します）'
      : '（メーカー名は入力不要です）';

  return textMessage(
    `${forWhom}${lead}\n\nお薬の名前を${MIN_QUERY_LENGTH}文字以上で送ってください。${makerNote}` +
      pendingSummary(session.pending),
    controlItems(session.pending.length)
  );
}

/**
 * 登録を開始する
 * @param {string} lineUserId - 操作している人のLINE userId
 * @param {{targetKey: string, targetName: string, isPharmacist: boolean}} target
 */
async function start(lineUserId, target) {
  const session = await startEntry(lineUserId, {
    targetKey: target.targetKey,
    targetName: target.targetName,
    source: target.isPharmacist ? SOURCE_PHARMACIST : SOURCE_MANUAL,
    includeManufacturer: !!target.isPharmacist,
  });

  return [promptMessage(session, '📋 お薬手帳への登録を始めます。')];
}

/** 検索して候補を提示する */
async function handleSearch(lineUserId, session, query) {
  if (query.length < MIN_QUERY_LENGTH) {
    return [
      promptMessage(
        session,
        `「${query}」では短すぎます。${MIN_QUERY_LENGTH}文字以上で入力してください。`
      ),
    ];
  }

  const results = searchDrugs(query, {
    includeManufacturer: session.includeManufacturer,
    limit: MAX_CANDIDATES,
  });

  if (results.length === 0) {
    return [
      promptMessage(
        session,
        `「${query}」に該当するお薬が見つかりませんでした。別の名前でお試しください。`
      ),
    ];
  }

  const names = results.map((r) => r.name);
  await setCandidates(lineUserId, session, names);

  const list = names.map((name, i) => `${i + 1}. ${name}`).join('\n');
  const items = [
    ...names.map((name, i) => quickReplyItem(toLabel(name), `${POSTBACK_PICK}:${i}`, name)),
    ...controlItems(session.pending.length),
  ];

  return [
    textMessage(
      `「${query}」の候補です。下のボタンから選んでください。\n\n${list}` +
        pendingSummary(session.pending),
      items
    ),
  ];
}

/** 候補を選んで登録予定に積む */
async function handlePick(lineUserId, session, index) {
  const { session: updated, name, duplicated } = await addPending(lineUserId, session, index);

  if (!name) {
    return [promptMessage(session, '選択できませんでした。もう一度お薬の名前を検索してください。')];
  }

  const lead = duplicated
    ? `「${name}」はすでに登録予定に入っています。`
    : `✅「${name}」を登録予定に追加しました。`;

  return [promptMessage(updated, `${lead}\n続けて次のお薬を検索できます。`)];
}

/** 登録予定から1件取り消す */
async function handleRemove(lineUserId, session, index) {
  const { session: updated, name } = await removePending(lineUserId, session, index);

  if (!name) {
    return [promptMessage(session, `${index + 1}番は登録予定にありません。`)];
  }

  return [promptMessage(updated, `「${name}」を登録予定から取り消しました。`)];
}

/** まとめて登録して終了する */
async function handleSave(lineUserId, session) {
  if (session.pending.length === 0) {
    return [promptMessage(session, 'まだお薬が選ばれていません。')];
  }

  const added = await addMedications(session.targetKey, session.pending, session.source);
  await clearEntry(lineUserId);

  const list = session.pending.map((name, i) => `${i + 1}. ${name}`).join('\n');
  const forWhom =
    session.source === SOURCE_PHARMACIST ? `${session.targetName}さんのお薬手帳に` : 'お薬手帳に';
  const skipped = session.pending.length - added;
  const skippedNote = skipped > 0 ? `\n（うち${skipped}件はすでに登録済みでした）` : '';

  return [
    {
      type: 'text',
      text: `📋 ${forWhom}${added}件を登録しました。${skippedNote}\n━━━━━━━━━━━━━━\n${list}`,
    },
  ];
}

async function handleCancel(lineUserId) {
  await clearEntry(lineUserId);
  return [{ type: 'text', text: 'お薬手帳への登録をやめました。' }];
}

/**
 * 登録セッション中のテキストメッセージを処理する
 * @returns {Promise<Array|null>} 返信メッセージ。セッション中でなければ null
 */
async function handleText(lineUserId, text) {
  const session = await getEntry(lineUserId);
  if (!session) return null;

  const trimmed = text.trim();

  if (CANCEL_WORDS.includes(trimmed)) return handleCancel(lineUserId);
  if (SAVE_WORDS.includes(trimmed)) return handleSave(lineUserId, session);

  // 「取消:2」で登録予定から外す
  const removeMatch = trimmed.match(/^取消[:：]\s*(\d+)$/);
  if (removeMatch) {
    return handleRemove(lineUserId, session, Number(removeMatch[1]) - 1);
  }

  // 候補が出ている状態で番号だけ送られたら、その候補を選んだものとして扱う
  const numberOnly = trimmed.match(/^(\d+)$/);
  if (numberOnly && session.candidates.length > 0) {
    return handlePick(lineUserId, session, Number(numberOnly[1]) - 1);
  }

  return handleSearch(lineUserId, session, trimmed);
}

/**
 * 登録セッション中のポストバック（ボタン）を処理する
 * @returns {Promise<Array|null>} 返信メッセージ。対象外なら null
 */
async function handlePostback(lineUserId, data) {
  const session = await getEntry(lineUserId);
  if (!session) return null;

  if (data === POSTBACK_SAVE) return handleSave(lineUserId, session);
  if (data === POSTBACK_CANCEL) return handleCancel(lineUserId);

  const pickMatch = data.match(new RegExp(`^${POSTBACK_PICK}:(\\d+)$`));
  if (pickMatch) {
    return handlePick(lineUserId, session, Number(pickMatch[1]));
  }

  return null;
}

module.exports = {
  START_COMMAND,
  start,
  handleText,
  handlePostback,
};
