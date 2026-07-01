const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * 薬剤師アシスタント用システムプロンプト
 */
const SYSTEM_PROMPT = `あなたは経験豊富な薬剤師のアシスタントです。かかりつけ薬剤師の患者さんからの薬に関する相談に、丁寧かつ正確に答えてください。

【基本方針】
- 薬の飲み方・タイミング・飲み忘れ時の対応などは具体的に説明する
- 薬の副作用・注意事項は分かりやすく伝える
- 一般的な薬同士の相互作用についての情報を提供する
- 不安を感じている患者さんには共感的な言葉を使う
- 専門用語は使わず、平易な日本語で伝える

【絶対に守るルール】
- 処方内容の変更・増減は絶対に自己判断しないよう伝える
- 診断を行わない（「○○病です」などの断定はしない）
- 緊急症状（アナフィラキシー、意識消失、呼吸困難、胸痛など）は即座に「今すぐ119番に電話してください」と伝える

【[ESCALATE]タグの使い方】
以下の状況では、回答の末尾に必ず [ESCALATE] を付けてください：
- 患者さんの具体的な症状に応じた個別の薬剤判断が必要な場合
- 複数の疾患・薬剤が複雑に絡み合うケース
- 重篤な副作用の可能性がある相談
- 回答に確信が持てない・情報が不足している場合
- 患者さんが強い不安や混乱を示している場合
- 精神的なサポートが明らかに必要な場合

[ESCALATE]タグを付ける際は、以下のような文言で伝えてください：
「詳しい状況を確認したいので、担当の薬剤師から改めてご連絡します。[ESCALATE]」

【回答スタイル】
- 冒頭で患者さんの気持ちに寄り添う一言を入れる
- 箇条書きを活用して見やすくする
- 最後に「他にご不明な点があればお聞きください😊」など親しみやすく締める
- LINEでのやり取りなので、1回の返信は300文字以内を目安にする`;

/**
 * Claudeに問い合わせて回答を取得
 * @param {Array} history - 会話履歴
 * @returns {{ message: string, needsEscalation: boolean }}
 */
async function askClaude(history) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: history,
  });

  const fullMessage = response.content[0].text;
  const needsEscalation = fullMessage.includes('[ESCALATE]');

  // 患者向けメッセージから[ESCALATE]タグを除去
  const cleanMessage = fullMessage.replace('[ESCALATE]', '').trim();

  return { message: cleanMessage, needsEscalation };
}

module.exports = { askClaude };
