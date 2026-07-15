# かかりつけ薬剤師 — プロジェクト概要

LINE公式アカウント＋ホームページで、患者さんの薬相談にAI（Claude）が自動応答し、対応困難な内容は薬剤師に取り次ぐシステム。Node.js/Express、Render（無料プラン）にデプロイ、Redis（ioredis）で永続化。

## 3つの窓口

| 窓口 | URL | 認証 |
|---|---|---|
| LINE公式アカウント | （LINEアプリ内） | 認証コード＋同意 |
| 患者さん向けHP | `/patient`（チャット）、`/medications`（お薬手帳）、`/guide`（使い方案内・公開） | 認証コード＋同意（`session_id`cookie） |
| 薬剤師専用HP | `/host`（入口）→`/console`（患者対応）、`/admin`（記事管理）、`/host-guide`（マニュアル）、`/pharmacists`（薬剤師の管理・owner専用） | 薬剤師ごとのログイン（名前選択＋パスワード、`admin_session`cookie） |

**かかりつけ薬剤師は複数名（`pharmacistManager.js`）。担当は認証コードで分別する**（詳細は下の「実装済み機能」）。薬剤師専用ページのログインは薬剤師ごと（名前を選ぶ＋パスワード）。移行期は旧共通パスワードもフォールバックで受ける。薬剤師#1（＝owner）のパスワードはLINE「管理者パスワード変更:新パスワード」、認証コードは「認証コード変更:新コード」でも変更可（どちらも薬剤師#1に反映）。他の薬剤師の追加・削除・コード/パスワード設定は`/pharmacists`（owner専用）またはLINE「薬剤師追加/一覧/コード/パスワード/削除」で行う。

## 主要ファイル

- `src/index.js` — Expressルート全部（LINE webhook、患者向けAPI、薬剤師向けAPI、静的ページ配信）
- `src/lineHandler.js` — LINEメッセージの全処理（特殊コマンド分岐、返信モード、一斉送信、エスカレーション）
- `src/claudeHandler.js` — Claude API呼び出し。`[ESCALATE]`（要対応判定）・`[SAVE_DRUG:薬品名]`（お薬手帳自動保存）タグをパース
- `src/pharmacistManager.js` — かかりつけ薬剤師の名簿（複数名）。パスワードはscryptハッシュ、患者向け認証コードは薬剤師ごとに一意で逆引き、`owner`フラグ、起動時マイグレーション
- `src/patientAssignmentManager.js` — 患者→担当薬剤師の紐づけ。お薬手帳と同じく`resolveBookKey()`を通す
- 各種Managerモジュール（`*Manager.js`）— Redis永続化の薄いラッパー。基本パターンは同じ：`get*`/`add*`/`remove*`

## 患者キーの命名規則（超重要）

全モジュール共通で、患者は以下の形式のキーで識別する：
- LINE患者：`line:<LINE userId>`
- Web患者：`web:<sessionId>`

`interventionRecordManager.js` / `medicationRecordManager.js` / `reminderManager.js` は全てこの規約に従う。`/console`のAPIでは、URLパスの`:id`は素のLINE userIdまたは`web:<uuid>`（`web:`プレフィックス付き）を受け取り、ルート内で`line:`を補って`patientKey`に変換している。

**お薬手帳だけは例外：同一人物として紐づけると`line:`と`web:`で1冊を共有する**（`medicationBookLinkManager.js`）。`medicationRecordManager.js`の全公開関数が入口で`resolveBookKey()`を通してキーを「正となるキー（＝LINE側）」に解決するため、**呼び出し側は同期を一切意識しなくてよい**。この解決を通さずにRedisのお薬手帳を直接読み書きすると同期が壊れるので注意（読みだけ解決して書きを解決し忘れる、が一番危ない）。会話履歴・対応記録・リマインダーは従来どおり窓口ごとに別。

## 実装済み機能（新しい順）

- **かかりつけ薬剤師を複数名（4名想定）化・担当を認証コードで分別（`pharmacistManager.js` + `patientAssignmentManager.js`）**：
  - **担当は「どの認証コードで認証したか」で決まる**。各薬剤師が固有の患者向け認証コードを持ち、患者さんがそのコードで認証（LINE：同意成立時／HP：`/api/verify`成立時）した時点で、その薬剤師が担当になる（`getPharmacistByAuthCode`で解決）。**割り当ては薬剤師が窓口で渡すコードで行う想定**（患者アプリ側からの薬剤師選択はしない）。お薬手帳と同じく`resolveBookKey()`を通すので、LINE⇔HP紐づけ済みの患者さんは担当も1つを共有
  - **薬剤師ごとログイン**：`/console`等のログインは名前プルダウン（`/api/pharmacists`）＋パスワード。セッションに`pharmacistId`を保持（`adminSessionManager`）。名簿が空の移行期は旧共通パスワードにフォールバック（`pharmacist-login.js`が名前欄を隠す）
  - **owner＝薬剤師#1**：起動時マイグレーションで既存の単一設定（`pharmacist_name`/`PHARMACIST_LINE_USER_ID`/`patient_passcode`/`admin_passcode`）から#1を作成し`owner`フラグを付与（`ensureOwnerFlag`は後付けも冪等に行う）。**ownerは削除不可**（Web・LINE・APIの全経路でガード）。名簿管理・認証コード変更・管理者パスワード変更はownerのみ、返信モード・患者一覧・エスカレーション受信は登録済み薬剤師全員（`lineHandler.js`のゲートを`getPharmacistByLineUserId`で一般化）
  - **担当で変わる挙動（フェーズ2・実装済み）**：エスカレーション／「解決しなかった」／ビデオ通話希望の通知を、患者さんの担当薬剤師のLINEへ振り分ける（`pharmacistNotifier.js`。未割り当て・担当LINE未連携なら全アクティブ薬剤師へ、それも無ければ環境変数の元管理者へフォールバック。LINE・HP両方）。`/medications`は患者本人の担当薬剤師名を表示（未割り当てはグローバル名）。対応記録に記録者（ログイン中の薬剤師）を刻み`/console`とCSVに表示。`/console`は患者一覧に担当バッジ・「自分の担当のみ」フィルタ・担当の手動割り当てプルダウン（`PUT/DELETE /api/admin/patients/:id/assignment`）。お問い合わせ（患者以外）の通知だけは従来どおり管理者宛て
  - **Renderデプロイ注意**：稀にデプロイが「live」でも古いインスタンスが残り新コードが反映されないことがある（sw.jsのCACHE_NAME版数やphase固有のルート/文言で反映確認し、ズレていたら`render deploys create ... --clear-cache`で再デプロイ）
  - **Web管理（`/pharmacists`・owner専用）**：薬剤師の追加・削除、認証コード・ログインパスワードの設定、LINE連携状況を確認。APIはハッシュ等を返さず状態のみ。LINEコマンドでも同等の操作が可能（`薬剤師追加/一覧/コード:ID コード/パスワード:ID パス/削除:ID`、本人がLINEから`薬剤師LINE連携:ID`で自分のuserIdを登録）。未連携の薬剤師には**連携用リンク＋QR**を表示（本人がタップ/読み取り→送信で連携完了。`buildLineLinkUrl`のoaMessageディープリンク、OAベーシックID既定`@118ubplz`）
  - **認証コードの自己変更＋名刺/A4チラシ印刷（`/mycard`・`namecard.js` + qrcode）**：各薬剤師が自分の認証コードを変更でき（`GET/PUT /api/pharmacist/me`。重複コードは拒否）、患者さんに渡す**名刺／A4チラシ**を印刷できる。名刺は担当名・認証コード・**LINE友だち追加QR＋HP用QR**・使い方入り。HP用QRは`/patient?code=…`を指し、**スキャンで認証コードが入力済み**になる（`patient-chat.js`がURLの`code`をpasscode欄へ）。印刷は3種：**名刺1枚／A4に複数枚（切り取り）／A4チラシ1枚**（`printNameCard(data,count)`・`printNameFlyer`）。**白黒印刷ベース（モノクロ設計）**——背景色は既定で印刷されないため、色に頼らず黒＋枠線。画面プレビュー＝配布物。ownerは`/pharmacists`で全員分を印刷可
- **画像からの読み取り精度（`imageEnhancer.js` + `claudeHandler.js`）**：LINE・HP共通。劣化画像でのベンチマークで詰めた結果、**過酷な条件で13/20→16/20剤、薬の捏造2件→0件**。要点：
  - `sharp`の`.rotate()`（引数なし＝EXIF準拠）が**必須**。無いと縦向き写真が横倒しのまま渡り、誤読どころか**実在する別の薬を捏造**する（実測で確認）
  - `resize`で**`fit: 'inside'`を絶対に省かない**。既定の`cover`は切り抜きになり、**薬品名が画像の外に切り落とされる**（実際に作り込んで発覚した不具合）
  - 長辺1568px（Claudeが内部で縮小する上限）に揃え、小さい写真は逆に拡大する。CLAHEで照明ムラを均し、控えめにシャープ化
  - プロンプトは「**読めない文字を推測で埋めるのは事故に直結する**」と明示し、読めた文字を先に書き出させてから薬品名を判断させる。これで捏造が消えた。規格が読めない`〇`混じりの名前はコード側でも必ず落とす（二重の防御）
- **お薬手帳のLINE⇔HP同期（`medicationBookLinkManager.js`）**：同じ患者さんでもLINEとHPは別キーのため、放っておくと手帳が2冊になる。「同一人物」と紐づけると**1冊を共有**する（正となるキーはLINE側。Webの`sessionId`は再ログインで変わるため）。紐づけ方法は2つ：**薬剤師が`/console`**でWeb患者を選び、LINE患者の一覧から選ぶ／**患者さんがLINE**で「ホームページと連携」と送って6桁コードを発行し、`/medications`で入力する。紐づけ時に既存の2冊は**マージ**され（薬剤師の手帳／患者さんの手帳の区分は保たれる）、解除時は内容をweb側に**コピーしてから**外すので薬は消えない。認証解除（`deleteSession`）時は自動で紐づけも外す
- **お薬手帳（`drugMaster.js` + `data/drugs.json` + `public/js/drug-picker.js`）**
  - **テキストからの自動記録は廃止**。実際に服用しているか不明で規格も特定できないため、`[SAVE_DRUG]`タグは**写真から読み取った場合のみ**有効。プロンプトで禁じるだけでなく`askClaude`内で「直近のユーザー発言に画像が無ければ`savedDrugs`を空にする」コード側の防御も入れている（二重の安全策・絶対に外さないこと）
  - **薬品名の検索**：支払基金の公式医薬品マスター（19,279件、薬品名に規格を含む）を`scripts/build-drug-master.js`で`data/drugs.json`に変換して同梱。改定時はスクリプト内のURLを更新して再実行するだけ。3文字以上・ひらがな可・前方一致優先
  - **メーカー名の扱い**：`searchDrugs(q, { includeManufacturer })`で出し分ける。**患者さんにはメーカー名（「トーワ」等）を除いた名称**（13,602件・同名は1件に集約。候補が膨らまずすっきりする）、**薬剤師には正式名称（メーカー名込み）**（19,279件・実際に調剤した銘柄を記録するため）。索引は`drugMaster.js`の`load()`で両方まとめて構築する（データファイルは1つ）
  - **お薬手帳は2冊に分かれる**（`source`で判別）。**薬剤師の手帳**（`pharmacist`：`/console`で登録）と**患者さんの手帳**（`manual`＝自分で登録／`photo`＝写真から／未設定=`legacy`＝旧テキスト自動記録で要確認）。**互いの手帳は削除できない**（`removeMedication(key, name, scope)`の`scope`が`'patient'`か`'pharmacist'`かで制御。LINE・Web・コンソールの全削除経路で必ず指定する）
  - 薬剤師の登録先は**担当患者のみ**（`resolveManagedPatientKey`が`/api/admin/patients`の一覧に無いIDを弾く）
  - **写真からの登録（薬剤師のみ）**：`POST /api/admin/patients/:id/medications/scan`に処方箋等の画像を送ると、`extractMedicationsFromImage`（claudeHandler）が薬品名を読み取り、`matchDrugName`（drugMaster）でマスタの正式名称に正規化して返す。**この時点では保存しない**——結果は「登録するお薬」リストに積まれるだけで、薬剤師が確認して登録ボタンを押して初めて保存される（AIの誤読をそのまま記録しないため）。マスタに該当が無い名前は`matched:false`で返し、画面で「誤読の可能性」と警告する
  - 検索〜まとめて登録のUIは患者用`/medications`と薬剤師用`/console`で`drug-picker.js`を共用
  - **LINEでも登録できる**（`lineMedicationEntry.js` + `medicationEntryManager.js`）。「お薬手帳に登録」で開始→3文字以上で検索→クイックリプライのボタン（または番号）で選択→繰り返し→「登録する」でまとめて保存。**登録中に処方箋等の写真を送ると、AIが読み取って登録予定に積む**（`handleImage`。これも保存はせず、確認してから登録）。**薬剤師は返信モード中**に同じコマンドを送ると、その患者さんの手帳にメーカー名込みで登録できる。会話の状態はRedis（30分TTL）に持つ。
    - **順序が重要**：登録セッション中の入力は、テキストも画像も、薬剤師の「返信転送」より前・患者のAIチャットより前に処理すること（後ろに置くと入力が横取りされる）
    - 写真の取得（`fetchImageBase64`）は登録チェックで一度だけ行い、AIチャットに流す場合は`event.__imageBase64`で使い回す（LINEから二重にダウンロードしない）
    - LINEのクイックリプライは**最大13個・ラベル20文字**まで。候補は10件に絞り、長い薬品名は省略して収めている
- **お薬の記事の初期コンテンツ（`defaultArticles.js`）**：厚労省・PMDA・くすりの適正使用協議会・日本薬剤師会・国立成育医療研究センター・消費者庁など**公的機関の一次情報で裏付けた10記事**（飲み忘れ・グレープフルーツ・抗菌薬の飲みきり・ジェネリック・お薬手帳・PTP誤飲・保管・成分の重複・ポリファーマシー・妊娠授乳）。各記事末尾に参考URLと免責文を付けている。サーバー起動時に`contentManager.seedDefaultArticles()`が**一度だけ**Redisへ投入（`articles_seeded_v1`フラグで冪等、同名記事はスキップ）。投入後は通常記事と同じく`/admin`・LINEで編集・削除できる（削除しても再投入されない）。**医療情報なので内容変更時は必ず一次情報を確認すること**
- **プライバシーポリシー・利用規約（`/privacy`・`/terms`）**：全ページのフッターからリンク。本文は`GET /api/legal`が`privacyPolicy.js`の`PRIVACY_POLICY_TEXT`（同意フローと共用＝二重管理しない）と`termsOfService.js`の`TERMS_OF_SERVICE_TEXT`を返し、`public/js/legal.js`が`data-legal`属性を見て描画する。どちらも`PHARMACIST_PHONE`環境変数を本文に埋め込む
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
- **ホームページで認証し直す（＝新しいセッションになる）と、お薬手帳の紐づけは切れる**。`web:<sessionId>`が変わるため。再度紐づければ復旧する（薬剤師が`/console`から数クリック）。内容は失われない
- CSSの`.reveal-left`/`.reveal-right`は要素を左右に48pxずらすため、モバイルでは横スクロールが出る。`html`/`body`への`overflow-x`はビューポートに伝播せず効かないので、700px以下では縦方向のフェードに切り替えて回避している

## 会話の運び方（ユーザーの好み）

- 大きめの新機能は提案→ユーザー承認→実装→プレビュー確認→デプロイ→本番確認、の順で進める
- 診療報酬改定など事実確認が要る話題はWebSearchで一次資料を当たり、不確実な点は正直に「見つからなかった」と書く
- 大きな設計判断はEnterPlanModeで一度立ち止まる。小さな修正・バグ修正は直接実装してよい
