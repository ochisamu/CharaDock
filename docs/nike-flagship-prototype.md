# AIニケちゃん・表現拡張プロトタイプ

標準 `nike-avatar` のPC表示専用。カスタム版ニケ、他キャラ、RLCD画像、
AIひろゆきのprofile素材には適用しない。完全な骨格アニメーションではなく、
画像生成した身振りスプライトと、ローカルの補間モーションを組み合わせる。

## 操作

1. 標準「AIニケちゃん」を選択。
2. JevのAPIキー、Jev本体、表情の選択を有効化。
3. 「ニケちゃん・表現拡張（試作）」をON。
4. 会話、または「考える・説明する・喜ぶ」のプレビューボタンで試す。

プレビューも固定ポーズの強制表示ではなく、例文を実際のJev APIへ送る。
音声なし。判定によっては別の演出や無演出になる。追加料金はJevの利用条件に従う。
OFF/キー未設定/タイムアウト時は従来の表示を使う。既定はOFF。

## 演出

- 生成ポーズ：考える（指を顎の近くへ）、説明（胸元で掌を上へ）、喜ぶ（両手を上げる）。
- 各ポーズは開眼/閉眼×口の閉/半開/開の6枚、合計18枚。
- 追加のローカル身振り：うなずき、驚いて引く、安心させる前傾。
- 通常約3.4秒、発話中は最大約6.8秒の演出と減衰。
- 頭・肩・手の独立したメッシュ変形、予備動作と時間差の追従。
  頭の回転は首元で滑らかに減衰し、目・口の位置合わせを保つ。
  手の変形は説明・喜びポーズの袖周辺だけに適用する。
- 割り込みは現在位置と速度を引き継ぐ臨界減衰スプリング。
- 実際の再生音量に合わせた頭・肩のアクセント。無音時に口パクを作らない。
- OSのreduced-motionでは追加の移動・ポーズ切替を抑える。
- 口パクと瞬きの制御は従来の音声/瞬きコントローラが引き続き所有する。
- Jevの表情が不確実でも、確信度を満たした身振りは独立して適用。
- 音声レベル/カーソル更新では身振りを再発火しない。
- キャラ変更時は即時リセット。追加素材はON時の標準ニケだけに読み込む。

Jevの既存リクエストにperformance質問を追加するため、毎フレームのAPI通信はない。
Liveでは意味のある最初の文（12文字以上＋句点/疑問符/感嘆符、または56文字以上）で
一度だけ判定する。短い返答は確定時に判定し、早期判定済みの返答を再送しない。
この早期判定は本プロトタイプをONにした標準ニケのみ。他キャラの動作は変更しない。
視覚演出のchoice確率は0.6以上を採用。音楽操作などの厳しい判定閾値は変更しない。

## 素材と再生成

完成素材：`assets/nike-avatar/performance-*-eyes-*-mouth-*.png`。
元の通常画像を置換せず、オプション素材として追加している。

画像生成は**組み込みimage_gen**を使用。CLI/APIキー方式ではない。
元絵 `assets/nike-avatar/eyes-open-mouth-closed.png` を編集対象とした。
採用した生成原画は `assets/nike-performance-sources/{ponder,explain,celebrate}.png` に保存。
再生成用の原画はデスクトップ配布対象外。作業領域はGit除外。
参照元のキャラクター表記・クレジットは変更しない。

プロンプト共通仕様：

> Identity-preserve edit of the exact AI Nike portrait. Preserve the original
> head position, face angle, eyes, closed mouth, purple ponytail, AI hairclip,
> jewelry, blue AITuber shirt lettering and pink/blue jacket. Genuine transparent
> background, square bust framing, no zoom or recentering, no captions/effects.
> Change only arms/hands; natural anatomy, all fingers within the canvas.

ポーズ指定：

- ponder: one index finger near the chin, below the face, not across the mouth.
- explain: palm up close to the torso, directly below the chin at chest height;
  do not extend the hand toward the edge or move the head to make room.
- celebrate: both small celebratory fists near the shoulders, below the face.

左右に手を広く伸ばした初案は頭の位置が変わったため不採用。
生成サイズと原画のサイズが異なるため、組み込み専用アセンブラで1536角へ揃え、
既存の登録済み目/口差分を局所合成する。喜ぶにはhappy、考えるにはthinkingの目を使う。
生成ポーズの輪郭alphaを保持し、口領域が顎の輪郭を削らないようにする。
透過端の清掃と胸像下端の統一も行う。

```bash
node scripts/build-nike-performances.cjs assets/nike-performance-sources
node --test desktop/tests/nike-performance.test.cjs
```

入力ディレクトリへ出力される `qa.png` の18コマを目視し、目・口の変化、輪郭、顎、手の見切れを確認する。
アセンブラは**このニケ原画専用**。任意キャラへ流用する汎用変換ではない。
新キャラは自身の原画・アンカー・ポーズ位置合わせ・全6状態の検証が必要。

## 検証と撮影

`desktop/tests/nike-performance.test.cjs` はJev opt-in、確率検証、独立した
身振り判定、範囲/減衰/reduced-motion、割り込み、切替リセット、SSEの一過性、
18枚のサイズ/差分/登録位置を検査する。

Jev実APIに合成した例文だけを送り、ponder/explain/celebrateを確認した。
APIキーやユーザーの会話はテスト記録に含めない。
映像は専用の撮影profile上の実Electronレンダラーをキャプチャする。
画像を後から動かしたモック動画ではない。初回の無音プレビューと、
Live＋Beatriceによる音付き実会話デモは別ファイルとして保存する。

2026-09-20確認：desktopテスト939件、Python静的テスト58件成功。
実APIの3例文はponder/explain/celebrateを選択し、撮影時の判定は562–629ms。
少数例の測定であり、精度や応答時間の保証ではない。
初回 `nike-flagship-demo.mp4` は約21秒、520×650、実測約30fps、無音。
ユーザー指定先へ移動済みで、作業ディレクトリには原動画を保持していない。
撮影環境は実profileの許可リスト設定をコピーした専用profile。履歴はコピーせず、
撮影後はテストキーを解除して撮影プロセスを終了した。通常のprofileは変更していない。
Windows開発ソースへ同期済み。稼働中の通常アプリは再起動後に新設定を表示する。

### 音付きLive撮影

- `prepare-capture-profile.ps1 -IncludeSelectedBeatrice` で、そのキャラが選択中の
  Beatriceモデル参照と声質設定だけを明示的に引き継ぐ。モデル自体は同梱しない。
- 文字入力から実際のLive応答を生成する。台本音声への差替えはしない。
  録画用の入力トラックは無音にし、部屋のマイクを開かない。
- 設定画面が音声出力を所有する場合、`capture-renderer.cjs` に
  `--url=mode=obs --audio-url=desktop/control.html --audio-output=<absolute.webm>` を指定。
- 音声manifestの `startedOffsetMs` から映像metadataの `audioLeadMs` を引いた位置へ
  音を配置する。複数トラックを単純連結しない。音声終了後も数秒の余白を残す。
- 設定画面がLiveを所有する場合も、マスコットへ接続状態のみ通知してLIVE表示にする。
  SDP/音声トラックは転送しないので、二重再生を起こさない。

音付き版の実測（2026-09-20）：2往復、25.4秒、520×650、30fps、AAC 48kHz。
素材は実レンダラー50秒・1501フレーム、実測30.009fps。
`nike-live-beatrice-demo.mp4` を指定の `N:\tmp` に保存し、SHA-256一致確認。
会話のない待機区間のみ編集。音声は収録時の時刻差で映像へ合わせ、
動画の音量だけ+6dB（アプリ内の声質/ゲイン設定は変更しない）。
録画後にLive接続を停止し、撮影profileのテストキーを解除してプロセスを終了。
desktopテスト942件、Python静的テスト58件とJS runtime検査を確認。

### 追加の表情・動作デモ

同じ揺れを繰り返す代わりに、うなずきは二段のストローク、驚きは後退から復帰、
寄り添いはゆっくり前進、説明は手と肩が遅れて追従する有限の動きにした。
apple-designの割り込み時の位置・速度保持を維持し、会話中の短い無音には650msの
猶予を置く。一度解放したポーズは後の音声だけでは復活しない。最大保持は6秒。
設定の実Jevプレビューにも「うなずく・驚く・寄り添う」を追加した。
プレビューは例文を分類するため、ボタン名の動作を強制するものではない。

`nike-expressions-live-demo.mp4` は追加の実Live＋Beatriceデモ（38秒）。
読書か散歩を相談、空想の巨大な花に驚く、落ち込んだ相手を励ます、の3往復。
実際のJev判定はexplain、surprised/recoil、soft/reassure（611/536/564ms）。
録画は70秒2101フレーム、実測30.003fps。無音の待機だけを切り、
520×650、30fps、AAC 48kHz、動画側のみ+6dBに揃えた。
従来のデモは上書きせず保持する。desktopテスト943件とJS runtime検査が成功。

### 表情の遅れと統合版

原因は素材だけではなかった。Liveは一文または56文字を待ってから分類し、
表情は4.5秒で終了していた。また、ポーズPNGは焼き込み顔を優先しており、
Jevの表情と手のポーズを同時に表示できなかった。soft画像も未搭載だった。

- ニケ試作版の早期分類を28文字、または意味のある短い感情語まで前倒し。
  1応答1回のAPI上限は維持。ジェスチャーを文字列ルールで強制しない。
- 表情の保持上限を試作版のみ9秒へ変更。API通信待ちやLive字幕自体の遅れは
  残るため、音声と完全同期する保証ではない。音声を待たせてはいない。
- ポーズと顔を分離し、登録済み目・眉・口の画像を局所合成。
  瞬きと口パクは元の制御を維持。合成キャッシュは最大12枚。
- softの生成原画を `assets/nike-performance-sources/soft.png`、
  口パク3枚を `assets/nike-avatar/emotion-soft-mouth-{closed,half,open}.png`
  に追加。生成結果の目位置を `scripts/build-nike-soft.cjs` で登録し、
  既存composerで目以外と音声所有の口画素・alphaを保持して検証する。

内蔵imagegenで使用したプロンプト：

> Use case: identity-preserve. Edit target is attached registered PNGTuber sprite.
> Create ONE gentle comforting soft expression variant for AI Nike. Change ONLY
> both eyes/eyelids and eyebrows: noticeably tender relaxed half-lidded eyes
> (still open), gently raised inner brows, warm reassuring gaze, not sad or sleepy.
> Preserve golden irises. Keep mouth completely unchanged closed, all original
> face geometry, head angle, positions, purple hair, ponytail, AI hairpin,
> earrings, cyan AITuber shirt, jacket, silhouette, canvas and crop exactly
> unchanged. No reframing or resizing of character. Output square 1536x1536
> aligned to original with true transparent background. Not a new design.
> Expression must be legible at small display size. No other elements or text.
> Keep eye centers at (557,639) and (731,614) on the 1536 square reference.

実際の生成サイズは1254角だったため、原画を残して目アンカーを登録した。
生成された鼻・頬は採用せず、目領域以外は元画像を使用する。

統合版 `nike-live-showcase-v2.mp4` は49秒、520×650/30fps/AAC48kHz。
最初の喜び・紹介と、相談・驚き・寄り添いを修正版で再録。
前半4場面とsoft追加後の最後の場面を、各収録音声の時刻を維持して連結した。
以前のデモは保持し、動画側のみ+6dB。実APIの判定時間は今回約0.6秒。
素材未搭載とポーズが顔を隠す退行テストを追加。desktop945件成功。

### 発話前の聞き手リアクション

字幕は音声より後に届く場合があるため、字幕の文字数閾値だけでは発話開始と
表情を同期できない。ニケ拡張ON時はLive Chatの文字入力受付時、および音声入力の
確定時に聞き手としてのJev判定を開始する。回答字幕が来たら話し手として判定し直す。
聞き手は相手の悲しみをそのまま演じず、慰める反応を選ぶよう役割を明示する。
まだ存在しない回答内容や、未完了の操作の成功を先取りして演じない。
1往復あたり最大2分類（入力と回答）。音声の生成・再生は待たせない。
短い応答や遅いAPIでは先行表示が間に合わない可能性は残る。
この変更は自動テストで確認済み。実音声での先行時間は未計測。

### 追加3表情（2026-09-20）

- joy：満面の笑顔。上向きの笑い目。
- worried：困り顔。内側が上がった眉と不安な視線。
- proud：得意げ。半眼と左右差のある眉。

各表情に口の閉/半開/開を用意し、通常の音声駆動口パク・瞬きを維持。
既存表情は削除しない。Jevの拡張選択肢は標準ニケの拡張ON時だけ使用する。
他キャラやカスタム素材の必須ファイルは増やさず、追加表情がない場合は通常顔。
設定画面のプレビューも実APIに例文を送る方式で、結果は確率によって変わる。
joyとhappyが競合しないよう、前者は強い喜び、後者は控えめな微笑みに分離した。
顔の採用閾値0.75、操作系の安全閾値は変更していない。

内蔵imagegenで元の `assets/nike-avatar/eyes-open-mouth-closed.png` を編集した。
生成原画は `assets/nike-performance-sources/{joy,worried,proud}.png`。
登録済み完成品は `assets/nike-avatar/emotion-{joy,worried,proud}-mouth-{closed,half,open}.png`。
生成時に変わった体・鼻・口は採用せず、`scripts/build-nike-extra-emotions.cjs`
のレビュー済みアンカーで目/眉だけ登録する。共通composerが元のalphaと口画素を
保つことを検証する。原画は1254角、完成品は既存rigに合わせ1536角。

再生成：

```bash
node scripts/build-nike-extra-emotions.cjs
node --test desktop/tests/nike-performance.test.cjs desktop/tests/emotion-sprites.test.cjs
```

使用プロンプト共通部：

> Use case: identity-preserve. Edit ONLY eyes and eyebrows of this exact
> registered AI Nike PNGTuber sprite. One single image, no sheet. Preserve
> original closed mouth unchanged, nose, skin, hair, AI pin, earrings, AITuber
> lettering, costume, all silhouette and exact pose/crop. Keep square canvas
> and source registration with surrounding transparent margins, do not zoom.
> Real transparent alpha background.

表情別の追記：

- joy: Exuberant full smile expressed by strongly smiling upward crescent
  eyelids, joyfully squeezed almost-closed eyes and lifted relaxed eyebrows.
  Distinct from mild happy. No tears, symbols or blush additions.
- worried: Clearly troubled puzzled expression: inner brows raised and knit,
  outer brows lowered, both golden eyes open with a concerned hesitant gaze.
  No tears, sweatdrops or symbols. Distinct from relaxed comforting soft.
- proud: Playfully self-assured smug expression: half-lidded golden eyes,
  one eyebrow slightly raised, the other relaxed, confident knowing gaze.
  No wink, no head tilt, no symbols. Distinct from sleepy or sad.

目視QAは配布画像ディレクトリではなくignored作業領域に保管する。
全desktopテスト953件成功。開発ログでは新表情名とuser/assistant分類を識別し、
入力本文・キーは表示しない。

音付き追加デモ `nike-expressions-v3.mp4` は30.5秒、520×650、30fps、AAC48kHz。
Live＋Beatriceに3場面を演じてもらった実収録で、台詞の書き出しを指定した演技デモ。
普通の自然会話で必ず同じ表情になると示すものではない。
実APIは回答にjoy/worried/proudを選び、今回の分類は245/268/561msだった。
これはAPI所要時間であって音声に対する先行時間ではない。
元映像75秒・2252フレーム（実測30.005fps）から無会話の待機だけを削り、
全返答の音声と口パク・瞬き・身振りを残した。音声オフセットはmanifestから反映。
動画のみ+6dB、アプリのBeatriceゲインは変更していない。
撮影profileのLiveを停止しテストキーを解除。既存動画と通常profileは保持する。

### 得意げのリテイク：ジト目

ユーザーのフィードバックにより、proudの片眉を上げた顔を、
両目とも水平気味の半目・落ち着いた眉のジト目へ置換した。
内蔵imagegenで元の通常顔を編集。旧原画proud.pngは比較用に保持し、
再生成スクリプトはproud-v2-jitome.pngを使用する。
完成品のemotion-proud-mouth-{closed,half,open}.pngを更新し、
口パク・瞬き・他の表情・Jevの選択条件は変更していない。
以前のデモ動画は旧表情のまま保持する。

使用プロンプト：

> Use case: identity-preserve. Edit this exact registered AI Nike PNGTuber sprite, ONLY eyes and eyebrows. Give her a clear cute anime JITOME expression: BOTH upper eyelids nearly straight horizontal (relative to the tilted face), lowered across the upper half of both golden irises, lower lids soft, small calm pupils looking toward viewer; level low relaxed eyebrows, no raised eyebrow, no arched smug eyebrow, no seductive upward outer corners. A dry deadpan 'really?' look, gently unimpressed and affectionate, not mean, angry, sleepy or sad. Distinctive flat-lidded jito eyes rather than smug narrow cat eyes. Preserve existing CLOSED mouth, nose, head position, face angle, purple hair, AI clip, earrings, costume, lettering, silhouette and EXACT crop and margins. No head movement, no zoom. Transparent background. One square image, not a sheet. Preserve all pixels outside eyes/brows as closely as possible.
