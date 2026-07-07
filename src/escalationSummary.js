/**
 * エスカレーション通知用に、会話履歴から患者さんの発言だけを
 * 時系列でまとめるモジュール（LINE・Web共通）
 *
 * 履歴自体が直近MAX_HISTORY件（約5往復）に丸められているため、
 * ここで返すのは「今回の一連の相談」に相当する範囲になる。
 */

// 画像送信時にコード側で自動付与している定型文（患者さん本人の発言ではない）
const IMAGE_BOILERPLATE_PREFIX = 'この薬、または お薬手帳の写真です';

const PER_MESSAGE_LIMIT = 300; // 1発言あたりの最大文字数
const TOTAL_LIMIT = 1500; // 一覧全体の最大文字数（LINEの5000字制限に余裕を持たせる）

function extractPatientText(content) {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const hasImage = content.some((part) => part.type === 'image');
    const textPart = content.find((part) => part.type === 'text');
    let text = textPart && textPart.text ? textPart.text.trim() : '';
    if (text.startsWith(IMAGE_BOILERPLATE_PREFIX)) {
      text = '';
    }
    if (hasImage) {
      return text ? `📷（写真あり）${text}` : '📷（お薬・お薬手帳の写真）';
    }
    return text;
  }
  return '';
}

/**
 * 会話履歴から患者さんの発言一覧を通知用テキストに整形する
 * @param {Array<{role: string, content: any}>} history
 * @returns {string} 番号付きの発言一覧（最新の発言に「←今回」印）
 */
function formatPatientMessages(history) {
  const texts = (history || [])
    .filter((m) => m.role === 'user')
    .map((m) => extractPatientText(m.content))
    .filter(Boolean)
    .map((t) => (t.length > PER_MESSAGE_LIMIT ? `${t.slice(0, PER_MESSAGE_LIMIT)}…` : t));

  if (texts.length === 0) {
    return '';
  }

  const numbered = texts.map((t, i) => {
    const marker = i === texts.length - 1 && texts.length > 1 ? `【${i + 1}】←今回` : `【${i + 1}】`;
    return `${marker}\n${t}`;
  });

  // 全体が長すぎる場合は古い発言から省略（最新側を優先して残す）
  const kept = [];
  let total = 0;
  let omittedCount = 0;
  for (let i = numbered.length - 1; i >= 0; i--) {
    if (kept.length > 0 && total + numbered[i].length > TOTAL_LIMIT) {
      omittedCount = i + 1;
      break;
    }
    kept.unshift(numbered[i]);
    total += numbered[i].length;
  }

  let result = kept.join('\n\n');
  if (omittedCount > 0) {
    result = `（それ以前の${omittedCount}件は省略）\n\n${result}`;
  }
  return result;
}

module.exports = { formatPatientMessages };
