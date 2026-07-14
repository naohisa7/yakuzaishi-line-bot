# かかりつけ薬剤師 — プロジェクト概要

LINE公式アカウント＋ホームページで、患者さんの薬相談にAI（Claude）が自動応答し、対応困難な内容は薬剤師に取り次ぐシステム。Node.js/Express、Render（無料プラン）にデプロイ、Redis（ioredis）で永続化。

## 3つの窓口

| 窓口 | URL | 認証 |
|---|---|---|
| LINE公式アカウント | （LINEアプリ内） | 認証コード＋同意 |
| 患者さん向けHP | `/patient`（チャット）、`/medications`（お薬手帳）、`/guide`（使い方案内・公開） | 認証コード＋同意（`session_id`cookie） |
| 薬剤師専用HP | `/host`（入口）→`/console`（患者対応）、`/admin`（記事管理）、`/host-guide`（マニュアル） | 共通パスワード（`admin_session`cookie） |

薬剤師専用ページのログインパスワードはLINEの「管理者パスワード変更:新パスワード」でいつでも変更可能。患者用認証コードは「認証コード変更:新コード」（LINE・HP共通）。

## 主要ファイル

- `src/index.js` — Expressルート全部（LINE webhook、患者向けAPI、薬剤師向けAPI、静的ページ配信）
- `src/lineHandler.js` — LINEメッセージの全処理（特殊コマンド分岐、返信モード、一斉送信、エスカレーション）
- `src/claudeHandler.js` — Claude API呼び出し。`[ESCALATE]`（要対応判定）・`[SAVE_DRUG:薬品名]`（お薬手帳自動保存）タグをパース
- 各種Managerモジュール（`*Manager.js`）— Redis永続化の薄いラッパー。基本パターンは同じ：`get*`/`add*`/`remove*`

## 患者キーの命名規則（超重要）

全モジュール共通で、患者は以下の形式のキーで識別する：
- LINE患者：`line:<LINE userId>`
- Web患者：`web:<sessionId>`

`interventionRecordManager.js` / `medicationRecordManager.js` / `reminderManager.js` は全てこの規約に従う。`/console`のAPIでは、URLパスの`:id`は素のLINE userIdまたは`web:<uuid>`（`web:`プレフィックス付き）を受け取り、ルート内で`line:`を補って`patientKey`に変換している。

## 実装済み機能（新しい順）

- **お薬手帳（`drugMaster.js` + `data/drugs.json` + `public/js/drug-picker.js`）**
  - **テキストからの自動記録は廃止**。実際に服用しているか不明で規格も特定できないため、`[SAVE_DRUG]`タグは**写真から読み取った場合のみ**有効。プロンプトで禁じるだけでなく`askClaude`内で「直近のユーザー発言に画像が無ければ`savedDrugs`を空にする」コード側の防御も入れている（二重の安全策・絶対に外さないこと）
  - **薬品名の検索**：支払基金の公式医薬品マスター（19,279件、薬品名に規格を含む）を`scripts/build-drug-master.js`で`data/drugs.json`に変換して同梱。改定時はスクリプト内のURLを更新して再実行するだけ。3文字以上・ひらがな可・前方一致優先
  - **お薬手帳は2冊に分かれる**（`source`で判別）。**薬剤師の手帳**（`pharmacist`：`/console`で登録）と**患者さんの手帳**（`manual`＝自分で登録／`photo`＝写真から／未設定=`legacy`＝旧テキスト自動記録で要確認）。**互いの手帳は削除できない**（`removeMedication(key, name, scope)`の`scope`が`'patient'`か`'pharmacist'`かで制御。LINE・Web・コンソールの全削除経路で必ず指定する）
  - 薬剤師の登録先は**担当患者のみ**（`resolveManagedPatientKey`が`/api/admin/patients`の一覧に無いIDを弾く）
  - 検索〜まとめて登録のUIは患者用`/medications`と薬剤師用`/console`で`drug-picker.js`を共用
- **SEO**：meta description・OGP・Pharmacy構造化データ（index.htmlのみ）・`robots.txt`・`sitemap.xml`・スタッフページへの`noindex`
- **アップロード検証**：`/api/chat`の画像アップロードにmulter `fileFilter`（画像MIMEタイプのみ許可）＋`sharp`再エンコードで無害化
- **`/host`**：薬剤師用の入口ページ（3つのツールへのリンクカード）
- **対応記録（`interventionRecordManager.js`）**：令和8年度診療報酬改定対応。フォローアップ・残薬調整・有害事象防止・訪問の記録を`/console`で追加・編集・削除。月ごとに折りたたみ表示、5年保持。月次CSV出力あり
- **患者一覧バッジ**：直近6か月の対応記録から「🔔フォロー対象」「🏠訪問検討」を自動判定表示（正式なレセプト実績ではなく代理指標）
- **服薬リマインダー（`reminderManager.js`）**：薬剤師が`/console`で患者ごとに時刻・メッセージを設定（回数無制限）。外部cronサービスが`GET /api/cron/medication-reminders?token=CRON_SECRET`を叩く方式（Render無料プランに内蔵スケジューラがないため）。「設定時刻を過ぎていて今日未送信なら送る」判定なのでcron間隔がずれても確実に届く
- **`/host-guide`・`/guide`**：薬剤師用マニュアル（パスワード保護）と患者用ガイド（公開）。目次付き
- **患者チャットコンソール（`/console`）**：LINE・Web両方の患者を1画面で一覧・チャット・一斉送信（確認ダイアログ必須）・認証解除
- **かかりつけ薬剤師名表示**：`/medications`ページに表示。LINEの「薬剤師名変更:氏名」で設定
- **音声入出力**：ホームページチャットに読み上げ（🔊、絵文字・記号除去、段落間ポーズ）、Android限定の音声入力ボタン（iPhoneはWebKit制約でOS標準キーボードのマイクを案内）
- **ビデオ通話**：Jitsi Meet（無料・会員登録不要）、`disableDeepLinking`でアプリインストール誘導を抑制
- **PWA**：ホーム画面への追加バナー、LINE内ブラウザでは案内表示に切り替え
- **フッターに著作権表示**（自動で年更新）

## デプロイ手順（毎回これ）

```bash
git add <files> && git commit -m "..." && git push
render deploys create srv-d92jmgvavr4c738etvq0 --confirm
# ScheduleWakeupで90秒おきにポーリング：
render deploys list srv-d92jmgvavr4c738etvq0 -o json --confirm
# statusが"live"になったらcurlで本番確認
```

Redis: `red-d933s79kh4rs739erea0`。ローカル開発機のIPはallowlist対象外なので、Redis依存のAPIはローカルでは常に失敗する（想定内、`fetch`をモックして描画確認する）。

## 既知の制約

- LINE患者の会話履歴（`conversationManager.js`）はメモリ内のみ→再起動で消える。Web患者側（`webConversationManager.js`）はRedis永続化
- 対応記録・リマインダーは全患者を毎回列挙して個別に問い合わせる設計（小規模運用前提、大量患者だと遅くなる可能性）
- 服薬リマインダーは外部cronサービスの登録がユーザー自身の作業（`CRON_SECRET`をRender環境変数に設定＋cron-job.org等に登録）
- お薬手帳の手動登録は`/medications`（Webセッション必須）でしか行えないため、**LINEしか使っていない患者さんは自分で登録できない**（HP側にも認証コードでログインしてもらう必要がある）
- CSSの`.reveal-left`/`.reveal-right`は要素を左右に48pxずらすため、モバイルでは横スクロールが出る。`html`/`body`への`overflow-x`はビューポートに伝播せず効かないので、700px以下では縦方向のフェードに切り替えて回避している

## 会話の運び方（ユーザーの好み）

- 大きめの新機能は提案→ユーザー承認→実装→プレビュー確認→デプロイ→本番確認、の順で進める
- 診療報酬改定など事実確認が要る話題はWebSearchで一次資料を当たり、不確実な点は正直に「見つからなかった」と書く
- 大きな設計判断はEnterPlanModeで一度立ち止まる。小さな修正・バグ修正は直接実装してよい
