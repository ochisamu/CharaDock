# PuruPuru Desktop Mascot

The Electron desktop app reuses the existing PuruPuru canvas renderer in a
transparent, frameless, always-on-top window. A separate control window handles
character selection, chat, microphone lip sync, speech input, expressions, and
desktop behavior.

## Start

```bash
npm install
npm run desktop
```

起動時は透明なキャラクターだけが表示されます。右下の `✦` へマウスを重ねるかクリックすると小さな会話欄が開き、離れると自動で収納されます。返答は顔へテールを向けた短いバブルへストリーミング表示されます。キャラクターへマウスを重ねている間は視線がカーソルを追い、離れると呼吸・揺れ・視線移動の待機モーションへ戻ります。顔付近をクリックするとキャラごとの短い反応が表示され、読み上げが有効なら選択中の音声でも再生されます。

小さな会話欄の左端にある `会話` を押すと、設定画面を開かずに `作業` モードへ切り替えられます。初回だけWindowsのフォルダー選択が開き、選択した作業先は細いチップで表示されます。チップを押すと作業先を変更でき、`作業` を押すと会話モードへ戻ります。作業モードはCodex app-server接続時のみ利用でき、選択フォルダーだけを書き込み可能なworkspace-writeセッションとして動作します。

キャラクター画面では、画像から想定した初期性格・話し方をキャラごとに編集できます。名前、性格、吹き出し位置は保存され、Chat/Workへ反映されます。追加キャラ3人には通常差分に加え、嬉しい・驚き・やさしく心配する表情PNGを収録しています。

「Codexのログイン」を選択した場合、キャラクター画面の「一枚絵からキャラクターを追加」からPNG・JPEG・WebPを選べます。同梱の `$build-purupuru-avatar` Skillを隔離されたworkspace-writeジョブで実行し、標準の目2段階×口3段階、前髪レイヤー、推定した性格・話し方・触れ合い文を検証してからライブラリへ追加します。この機能はログインと画像生成対応モデルが必要です。CharaDock専用のChatGPT接続では画像生成は利用できません。

Global shortcuts:

- `Ctrl+Shift+Enter`: open the compact character chat
- `Ctrl+Shift+M`: open settings and chat
- `Ctrl+Shift+L`: toggle click-through
- `Ctrl+Shift+H`: show or hide the character

## Chat / Work authentication

### Codex app-server

Choose **ChatGPTでサインイン** or **Codexのログイン** in AI Connection. The app launches the locally
installed `codex app-server --stdio`, performs the required JSON-RPC
initialization, and creates an ephemeral read-only conversation. It uses the
existing Codex login. Set `CODEX_CLI_PATH` if `codex` is not on `PATH`.
On Windows, the app also detects the Microsoft Store Codex installation. Its
protected CLI binary is copied into this app's user-data cache before launch so
that Windows permits app-server child-process execution.

未ログインの場合はAI接続画面の **ChatGPTでログイン** を押します。app-serverの
managed ChatGPT OAuthを開始し、既定ブラウザでログインした後、画面が
`ChatGPTログイン済み` へ自動更新されます。認証トークンの保存・更新はCodex側が
担当し、このアプリはトークンを受け取りません。
Codex設定では、app-serverから取得したプルダウンを使い、会話と作業それぞれに
モデルと推論の深さを指定できます。Codex既定を選ぶとCodex側の既定値を使い、
深い推論ほど応答に時間がかかる場合があります。

### CharaDock専用のChatGPT接続

**ChatGPTでサインイン → Continue with ChatGPT** を押し、ブラウザでログインとChatGPTプラン利用許可を完了します。APIキーは不要です。ローカルapp-serverへのResponsesプロバイダー設定とトークン受け渡しはCharaDockが行います。動的クライアント登録、PKCE・state・nonce、署名・issuer・audience・期限・アカウントの検証を行い、OSの暗号化で資格情報を保存します。安全な暗号化が使えない場合は起動中だけ保持します。

更新トークンのローテーションを直列化し、app-serverを次のターン開始前に再起動して同じスレッドを再開します。ログアウトはCharaDock専用接続だけを解除します。既存プロフィールは従来のCodex接続を維持し、新規プロフィールはこの方式を既定にします。

**Liveの接続** はCodexログインを使います。専用接続のトークンはCodex Liveエンドポイントに渡しません。APIキーによる会話とOpenAI文字起こしは廃止しました。

参照: [Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart)、[app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)、[preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)。

## Decision assist

AI接続画面の **判断アシスト → 判断サービス** で **JEV · TypeSafe** と
**OpenAI Decisions** を切り替えられます。有効化と各機能の設定は共通です。
Decisionsは **判断アシスト** 内の専用入力欄からOpenAI APIキーを管理します。保存済みのキーは引き継ぎ、会話と文字起こしには使用しません。キーを変更しても会話・Workはリセットしません。
JEVは専用のアプリAPIキーを使います。既存プロフィールの既定はJEVです。

対象はメディア操作、表情・身振り、通常TTSのハンズフリー呼びかけ判定です。
PC・設定チャット・Link・ATOM Echo・RLCDから同じ判断クライアントを使います。
切り替え中の古い判定は無効化し、接続失敗時に別サービスへ自動送信しません。

Decisionsは `POST https://api.openai.com/v1/decisions` / `gpt-6-luna` を使います。
既存の候補選択を `choice`、明示的な操作の確率判定を `predicate` に変換し、
候補別の確率へ既存のしきい値を適用します（`confidence` とは区別します）。
参照: [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions)。

`npm run desktop:win:dev:profile` は通常版と共通の
`%APPDATA%\charadock` プロフィールを使います。APIキーを更新したら保存後に
判断アシストの接続テストを実行してください。

検証スクリプト:
- `scripts/decisions-ui-smoke.cjs`: 隔離プロフィール、合成キー・API応答で実Windows設定画面とIPCを検証。
- `scripts/verify-decisions-profile.cjs`: Windows Electronで指定プロフィールの暗号化キーを読み、実APIを検証。引数は `SOURCE PROFILE FRESH_OUTPUT`。元プロフィールは変更しません。

## Voice and animation

- **Mic link** continuously measures microphone volume locally and sends only a
  numeric level to the mascot renderer for three-stage lip sync.
- **Voice input** can automatically prefer local Japanese recognition, or use explicit experimental Codex Realtime,
  stable Codex 0.145 local-audio turn input, the embedded sherpa-onnx runtime
  with a selectable on-demand Japanese ASR model, Chromium device speech recognition,
  or OpenAI transcription. The selected provider works from both
  the control chat and the compact mascot composer.
- The sherpa-onnx model selector offers Japanese ReazonSpeech Zipformer,
  Japanese NeMo Parakeet CTC, SenseVoice, and multilingual Whisper base/tiny.
  Models are downloaded only when selected, verified against pinned SHA-256
  digests, and can be removed from the settings screen.
- sherpa-onnx and OpenAI transcription use the official Silero neural VAD in
  the compact composer. Its small model is downloaded on first use and verified;
  the existing local energy detector remains available automatically if neural
  VAD initialization fails. Low/normal/high sensitivity changes speech and
  silence thresholds, and completed utterances can be sent automatically.
- Codex 0.145 audio input uses the same VAD and sends the completed recording
  directly as `localAudio`, without an extra API key or ASR model. Temporary
  recordings are deleted after the turn and on next boot.
- Reply read-aloud uses the operating system speech voice or a local
  Style-Bert-VITS2 server. Completed visible sentences enter a bounded queue so
  playback begins after the first sentence is synthesized instead of after the
  whole response. The bubble follows the sentence currently being spoken and
  restores the full reply afterward. Expressions follow each sentence while
  Style-Bert-VITS2 mouth motion follows the actual decoded audio envelope;
  system speech uses boundary-aware Japanese text timing. Speech movement is
  smoothed to avoid rapid whole-body or mouth jitter, and a thinking filler is
  allowed to finish before answer playback begins.
- Codex and OpenAI replies stream into both the control chat and the desktop
  speech bubble, with a light mouth pulse while text arrives.
- When the mouse rests, breathing, swaying, blinking, hair spring, and small
  autonomous gaze changes form the idle loop.
- Cursor following is active only while the pointer is over the mascot; follow
  speed, breathing, body lean/bounce, and hair motion are saved per character.
- Screen-share and browser permission prompts are read aloud when speech is
  enabled; while VAD is active, saying `いいよ` or `やめて` approves or declines.
- Screen and computer snapshots temporarily exclude the mascot through native
  capture protection without hiding its window, avoiding visible flicker.
- Approved browser turns disable built-in web search and require the visible
  dedicated browser. In addition to reading and navigation, it exposes bounded
  referenced clicks, safe text entry, option selection, keys, and scrolling.
- A separately consented Windows-computer turn can inspect the active display
  and perform bounded foreground clicks, Unicode typing, hotkeys, and scrolling.
  It is limited to 30 operations, remains interruptible, and must hand sensitive,
  destructive, representational, financial, installation, and security actions
  back to the user.
- The hooded character clips its hair layer to the hood opening; other custom
  characters use face-following spring hair.

## Build

Create an unpacked application directory:

```bash
npm run dist
```

Create an unpacked Windows application directory (also works from WSL):

```bash
npm run dist:win
```

`dist:win` はWineなしでも生成できるWindows用フォルダ版です。Windows上でNSISインストーラー／単体portable版を生成する場合は `npm run dist:win:installer` を使います。

### Piper Plus v2.0.0

The Windows sample download installs the official v2.0.0 Rust CLI 0.5.2,
Tsukuyomi-chan FP16, and the upstream English/Chinese phonemizer dictionaries.
Existing v1.13.0 models are SHA-256 verified and reused during the upgrade.
The bundled Japanese G2P dependency is independently versioned at npm 0.8.0.

Settings → Voice → Character voice → Piper Plus has an optional reference
WAV setting, saved per character. It requires the Rust CLI, an ONNX
model with a `speaker_embedding` input, and that model's compatible speaker
encoder ONNX. Select the model under manual files, select the encoder, and
choose a 1–30 second WAV. The sample has speaker embedding inputs, but voice
cloning quality depends on the model training and a compatible encoder.
Incomplete reference settings stop synthesis with setup guidance; they never
silently substitute the sample voice. Desktop and remote read-aloud use
the same main-process synthesis route. Full local reference paths stay private.

The default Tsukuyomi sample requires a 256-dimensional speaker embedding;
the publicly tested CAM++ encoder emits 192 dimensions, so that pair cannot
synthesize reference-conditioned speech. A matching zero-shot model and encoder
must be obtained separately. Reference-conditioned end-to-end synthesis has
not been validated; the settings UI alone does not establish voice cloning.
