# 💊 かかりつけ薬剤師 LINE Bot

患者さんからの薬に関する相談に、AIが24時間対応するLINEシステムです。

## システムの流れ

```
患者さん
  │ LINEでメッセージ送信
  ▼
LINE公式アカウント
  │ Webhook
  ▼
このサーバー（Node.js）
  │ Claude AI に問い合わせ
  ▼
Claude AI（薬剤師アシスタント）
  │ 回答生成
  ├─ 通常の質問 → 患者さんへ自動返信
  └─ 対応困難  → 患者さんへ返信 ＋ 薬剤師LINEに通知
                              │
                              ▼
                         薬剤師が直接返信
```

---

## セットアップ手順

### Step 1: LINE公式アカウントの作成

1. [LINE Developers](https://developers.line.biz/ja/) にアクセス
2. 「コンソールにログイン」→ LINE/Googleアカウントでログイン
3. 「新規プロバイダー作成」→ 任意の名前（例：○○薬局）
4. 「Messaging API チャネル」を作成
   - チャネル名：薬局名（例：田中薬局 お薬相談）
   - チャネル説明：かかりつけ患者様専用
5. 作成後、以下を控えておく：
   - **チャネルシークレット**（基本設定タブ）
   - **チャネルアクセストークン**（Messaging API設定タブ → 「発行」ボタン）

### Step 2: 薬剤師自身のLINE User IDを確認

1. LINE Developersコンソール → 作成したチャネル
2. 「Messaging API設定」タブ
3. 「あなたのユーザーID」欄に表示されているIDをコピー
   （例：U1234567890abcdef1234567890abcdef）

### Step 3: Anthropic APIキーの取得

1. [Anthropic Console](https://console.anthropic.com) にアクセス
2. アカウント作成・ログイン
3. 「API Keys」→「Create Key」
4. 生成されたキーをコピー（一度しか表示されません）

### Step 4: サーバーの準備

#### ローカル環境でのテスト（ngrokを使用）

```bash
# Node.jsがインストールされていることを確認
node --version  # v18以上推奨

# プロジェクトのセットアップ
cd yakuzaishi-line-bot
npm install

# 環境変数ファイルを作成
cp .env.example .env
# .envファイルをエディタで開き、各項目を入力

# ngrokでローカルを外部公開（別ターミナルで）
npx ngrok http 3000

# サーバー起動
npm start
```

#### 本番環境（推奨：Railway / Render / Heroku）

**Railwayの場合（無料枠あり・推奨）：**
1. [Railway](https://railway.app) でアカウント作成
2. 「New Project」→「Deploy from GitHub repo」
3. このプロジェクトをGitHubにpush後、連携
4. 「Variables」タブで環境変数を設定（.envの内容をそのまま）
5. デプロイ完了後、「Settings」→「Domains」でURLを確認

### Step 5: LINEのWebhook URLを設定

1. LINE Developersコンソール → Messaging API設定タブ
2. 「Webhook URL」に以下を入力：
   ```
   https://あなたのサーバーURL/webhook
   ```
3. 「検証」ボタンで `{"message": "ok"}` が返れば成功
4. 「Webhookの利用」をオンにする

### Step 6: 応答設定の調整

LINE Developersコンソール → Messaging API設定タブ：
- **応答メッセージ**：オフ（Botが自動返信するため）
- **あいさつメッセージ**：オン（任意で設定）

### Step 7: 患者さんへの案内

LINE公式アカウントのQRコードまたはIDを患者さんに共有：
1. Messaging API設定タブ → QRコードをダウンロード
2. 診察券や薬袋に印刷して配布
3. LINE ID（@から始まる）を口頭でお伝えする

---

## 環境変数一覧

| 変数名 | 説明 | 取得場所 |
|--------|------|---------|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINEチャネルアクセストークン | LINE Developers → Messaging API設定 |
| `LINE_CHANNEL_SECRET` | LINEチャネルシークレット | LINE Developers → 基本設定 |
| `PHARMACIST_LINE_USER_ID` | 薬剤師自身のLINE User ID | LINE Developers → Messaging API設定 |
| `ANTHROPIC_API_KEY` | Anthropic APIキー | console.anthropic.com |
| `PHARMACIST_PHONE` | 緊急時用電話番号（任意） | - |
| `PORT` | サーバーポート（デフォルト：3000） | - |

---

## 利用可能なコマンド（患者さん向け）

| コマンド | 動作 |
|---------|------|
| `ヘルプ` または `help` | 使い方を表示 |
| `リセット` または `reset` | 会話履歴を初期化 |

---

## カスタマイズ

### AIの応答をカスタマイズしたい場合

`src/claudeHandler.js` の `SYSTEM_PROMPT` を編集してください。

例：薬局名を追加する場合
```javascript
const SYSTEM_PROMPT = `あなたは○○薬局のかかりつけ薬剤師アシスタントです。...`;
```

### エスカレーションの通知内容を変えたい場合

`src/lineHandler.js` の `buildEscalationMessage` 関数を編集してください。

### 会話履歴の保持件数を変えたい場合

`src/conversationManager.js` の `MAX_HISTORY` の値を変更してください。

---

## コスト目安（月額）

| サービス | 無料枠 | 費用目安 |
|---------|--------|---------|
| LINE Messaging API | 月200通まで無料 | 超過分 ¥3/通 |
| Anthropic Claude API | - | 約¥0.3〜1/メッセージ |
| Railway（サーバー） | $5分まで無料 | $5〜/月 |

患者数50人で月500通程度の想定：**月額 2,000〜3,000円程度**

---

## セキュリティについて

- `.env` ファイルは絶対にGitHubにpushしない（`.gitignore` に追加済み）
- 本番環境では環境変数は必ずサーバーの設定画面で管理する
- 患者さんの個人情報を含む会話はサーバーメモリ上に一時保存される
- 長期運用では個人情報保護の観点からDBの暗号化を検討する

---

## よくある問題

**Q: Webhookの検証が失敗する**
→ サーバーが起動しているか確認。ngrokのURLが正しいか確認。

**Q: 薬剤師に通知が届かない**
→ `PHARMACIST_LINE_USER_ID` が正しいか確認。LINE公式アカウントを自分でもフォローしているか確認。

**Q: Botが返信しない**
→ サーバーのログを確認。`LINE_CHANNEL_ACCESS_TOKEN` が正しいか確認。
