// SPDX-License-Identifier: Apache-2.0
(function initializeCharaDockI18n(root) {
  "use strict";

  const ENGLISH = Object.freeze({
    "設定カテゴリ": "Settings categories",
    "設定を検索": "Search settings",
    "検索結果": "Search results",
    "コンパニオン": "Companion",
    "システム": "System",
    "会話": "Chat",
    "キャラクター": "Character",
    "音声": "Voice",
    "AI接続": "AI Connection",
    "デスクトップ": "Desktop",
    "サポート": "Support",
    "リモート": "Remote",
    "リモートアクセス": "Remote access",
    "停止中": "Off",
    "接続受付中": "Available",
    "開始できません": "Unavailable",
    "同じWi-FiにあるスマートフォンへキャラクターとChat / Workを表示し、文字で指示できます。マイクは使いません。": "See your character and use Chat / Work by text from a phone on the same Wi-Fi. No microphone is used.",
    "同じWi-Fiにある端末へキャラクターとChat / Workを表示し、文字で指示できます。マイクは使いません。": "See your character and use Chat / Work by text from a device on the same Wi-Fi. No microphone is used.",
    "ローカルLAN接続を有効にする": "Enable local LAN access",
    "初期状態はOFF。選んだプライベートLANだけで待ち受けます": "Off by default. Listens only on the selected private LAN address",
    "スマートフォン接続用QRコード": "QR code for phone pairing",
    "QRコードを準備中…": "Preparing QR code…",
    "QRコードを読み取る": "Scan the QR code",
    "スマートフォンの標準カメラで読み取ります。接続コードは10分で期限切れになり、端末セッションも自動で終了します。": "Scan with the phone's camera. The pairing code expires after 10 minutes, and device sessions expire automatically.",
    "端末ごとに標準カメラで1回読み取ります。URLは最初のペアリングまたは10分で無効になりますが、その端末は設定した有効時間まで再コピーなしで開けます。": "Scan once per device with its camera. The URL expires after the first pairing or 10 minutes, while that device can reopen without copying it again until its session expires.",
    "接続先を準備中": "Preparing address",
    "URLをコピー": "Copy URL",
    "接続できない場合は、Windows Defenderの確認で「プライベート ネットワーク」を許可し、両端末が同じWi-Fiか確認してください。": "If connection fails, allow Private networks in the Windows Defender prompt and confirm both devices use the same Wi-Fi.",
    "接続に使うネットワーク": "Network to use",
    "プライベートLANが見つかりません": "No private LAN found",
    "端末セッションの有効時間": "Device session duration",
    "15分": "15 minutes",
    "30分": "30 minutes",
    "1時間": "1 hour",
    "2時間": "2 hours",
    "8時間": "8 hours",
    "スマートフォンでWorkを許可": "Allow Work from phone",
    "現在の作業先と、このキャラのホーム内で作業できます": "Allows work inside the current project and this character's home",
    "スマートフォンでキャラ音声を再生": "Play character voice on phone",
    "通常TTSの設定済み音声をスマートフォン側でも生成します": "Generates the configured standard TTS voice for playback on the phone",
    "リモートの応答音声": "Remote response voice",
    "GPT-Live（PCでLive接続中）": "GPT-Live (while PC Live is connected)",
    "PCでも回答音声を再生": "Play response audio on the PC",
    "OFFにするとリモートから送った通常TTSをPCでは鳴らしません": "When off, standard TTS sent from a remote device stays silent on the PC",
    "ペアリング中の端末": "Paired devices",
    "端末名、最終接続、有効期限を確認して個別に解除できます": "Review device names, last activity, and expiry, then disconnect individual devices",
    "新しいQRコード": "New QR code",
    "すべての端末を解除": "Disconnect all devices",
    "プライベートネットワーク専用の実験機能です": "Experimental private-network feature",
    "通信はHTTPSではありません。信頼できる自宅・社内Wi-Fiでのみ使用してください。スマートフォンから画面撮影、ブラウザ操作、PC操作、許可への回答はできません。外出先からのアクセスやルーターのポート開放には使用しないでください。": "Traffic is not HTTPS. Use only on trusted home or workplace Wi-Fi. Phone access cannot capture the screen, control browsers or the PC, or answer approval prompts. Do not expose it through router port forwarding or use it from outside the LAN.",
    "セットアップと診断": "Setup and diagnostics",
    "初期設定を見直したり、不具合調査に必要な端末情報を安全にまとめたりできます。": "Review initial setup or safely collect device information for troubleshooting.",
    "アプリのアップデート": "App updates",
    "GitHub Releasesで最新版を確認します。更新は公式リリース画面を開いて行います。": "Checks GitHub Releases for the latest version. Updates are completed from the official release page.",
    "未確認": "Not checked",
    "現在": "Current",
    "最新": "Latest",
    "「今すぐ確認」でGitHub Releasesを確認できます。": "Choose Check now to query GitHub Releases.",
    "起動時に自動確認": "Check automatically at startup",
    "バックグラウンドで確認し、更新がある場合だけお知らせします": "Checks in the background and notifies you only when an update is available",
    "更新チャンネル": "Update channel",
    "Beta（プレリリースを含む）": "Beta (includes prereleases)",
    "今すぐ確認": "Check now",
    "更新内容を見る": "View update",
    "新しいバージョンがあります": "A new version is available",
    "閉じる": "Close",
    "初回セットアップ": "Initial setup",
    "現在の設定を保ったまま、AI接続・キャラクター・マイク・読み上げを順番に確認します。": "Review AI connection, character, microphone, and read-aloud without resetting current settings.",
    "セットアップをもう一度行う": "Run setup again",
    "診断情報": "Diagnostics",
    "アプリ・OS・GPU・選択中の音声方式・モデル導入状況・直近のアプリログをまとめます。": "Collects app, OS, GPU, selected voice methods, model readiness, and recent application logs.",
    "環境": "Environment",
    "GPU": "GPU",
    "生成日時": "Generated",
    "未取得": "Not collected",
    "共有前に確認できます": "Review before sharing",
    "APIキー、会話、キャラクターメモリ、作業内容、添付ファイル、ユーザー辞書、完全なローカルパスは含めません。": "Excludes API keys, conversations, character memories, work content, attachments, user dictionaries, and full local paths.",
    "情報を更新": "Refresh",
    "診断情報をコピー": "Copy diagnostics",
    "サポートZIPを保存": "Save support ZIP",
    "ログフォルダーを開く": "Open log folder",
    "準備中": "Getting ready",
    "状態を確認しています": "Checking status",
    "すぐ入力": "Quick input",
    "キャラクターと話す": "Talk with your character",
    "新しい会話": "New chat",
    "こんにちは。今日は何をしようか？": "Hi! What shall we do today?",
    "表情操作": "Expression controls",
    "表情": "Expression",
    "通常": "Neutral",
    "にこっ": "Happy",
    "びっくり": "Surprised",
    "やさしく": "Soft",
    "おやすみ": "Sleepy",
    "メッセージを入力…（Ctrl＋Enterで送信）": "Type a message… (Ctrl+Enter to send)",
    "ここにファイルをドロップ": "Drop files here",
    "添付ファイル": "Attachments",
    "ファイル": "File",
    "設定画面では文字入力のみ": "Text input only in Settings",
    "会話と作業の履歴": "Chat and work history",
    "表示する履歴": "History to display",
    "会話モード": "Chat mode",
    "作業モード": "Work mode",
    "作業フォルダー": "Work folder",
    "作業先": "Workspace",
    "作業先プロジェクト": "Work project",
    "開く": "Open",
    "変更": "Change",
    "追加": "Add",
    "作業モード · 選択フォルダー内へ書き込みできます": "Work mode · Can write inside the selected folder",
    "作業モードで実行した依頼と結果がここに残ります。": "Work-mode requests and results will appear here.",
    "進捗を表示": "Show progress",
    "成果物": "Outputs",
    "外部で開く": "Open externally",
    "プレビューを閉じる": "Close preview",
    "差し込む": "Follow up",
    "差し込みを受け付けました。現在の応答を止めています…": "Follow-up queued. Stopping the current response…",
    "送信": "Send",
    "中断": "Stop",
    "Codex app-serverを使用します。": "Using Codex app-server.",
    "見た目と振る舞い": "Appearance and behavior",
    "クリックすると透明ウィンドウのキャラクターがすぐ切り替わります。": "Click a character to switch the transparent desktop window immediately.",
    "キャラクター設定内を移動": "Navigate character settings",
    "キャラクターホームと担当プロジェクト": "Character Home and attached projects",
    "このキャラ専用のホームを持ち、既存フォルダーは移動せず担当プロジェクトとして切り替えられます。": "Give this character a private home and switch existing folders as attached projects without moving them.",
    "プロジェクトを追加": "Add project",
    "一覧と設定": "Library & settings",
    "動き": "Motion",
    "キャラを追加": "Add character",
    "キャラクターを追加": "Add a character",
    "完成済みのパッケージを読み込むか、一枚の画像から新しく作成できます。": "Import a finished package or create a new character from one image.",
    ".purupuruからキャラクターを追加": "Add from a .purupuru file",
    "画像・表情差分・髪レイヤー・調整値をアプリ内へコピーします。元ファイルを移動・削除しても使えます。": "Copies images, expressions, hair layers, and tuning data into the app so the original file can be moved or deleted.",
    ".purupuruを選択": "Choose .purupuru",
    "80MBまで": "Up to 80 MB",
    "クリックまたはD&D · 80MBまで": "Click or drag and drop · up to 80 MB",
    "一枚絵からキャラクターを追加": "Create a character from one image",
    "目の開閉×口3段階の6差分と、独立して揺れる前髪を生成し、画素単位の品質検査後に追加します。": "Generates six eye/mouth states and a separately moving front-hair layer, then validates quality pixel by pixel.",
    "Codexのみ": "Codex only",
    "画像を選択": "Choose image",
    "選択したキャラクター画像": "Selected character image",
    "PNG・JPEG・WebP / 15MBまで": "PNG, JPEG, or WebP / up to 15 MB",
    "キャラクター名（任意）": "Character name (optional)",
    "空欄なら画像から提案": "Leave blank to suggest from the image",
    "性格・話し方（任意）": "Personality and speaking style (optional)",
    "例：明るく好奇心旺盛。短く親しみやすく話す。空欄なら画像から提案": "Example: Bright and curious, speaking in short, friendly sentences. Leave blank for a suggestion.",
    "名前や性格が空欄の場合だけ、元絵の雰囲気から提案します。生成中はCodexの利用枠を消費し、数分かかることがあります。": "CharaDock suggests only fields left blank. Generation uses your Codex allowance and may take several minutes.",
    "この画像をアップロード・加工・利用する権利があります": "I have the rights to upload, modify, and use this image",
    "CodexでPuruPuru化": "Create PuruPuru with Codex",
    "画像を選択してください。": "Choose an image.",
    "AI接続を「Codex app-server」にすると利用できます。": "Available when AI Connection is set to Codex app-server.",
    "キャラクター一覧": "Character library",
    "キャラクター設定": "Character settings",
    "名前と性格は会話にも反映されます。吹き出しはキャラクターに重なる位置へ調整できます。": "The name and personality affect conversations. You can also position the speech bubble over the character.",
    "名前": "Name",
    "性格・話し方": "Personality and speaking style",
    "このキャラのメモリ": "This character's memories",
    "会話から自動で覚えた呼び名・好み・継続目標です。ほかのキャラとは共有しません。": "Names, preferences, and ongoing goals learned automatically from conversations. They are not shared with other characters.",
    "すべて忘れる": "Forget all",
    "吹き出し 左 (%)": "Bubble left (%)",
    "上 (%)": "Top (%)",
    "幅 (%)": "Width (%)",
    "デスクトップ表示と動き": "Desktop appearance and motion",
    "表示サイズと顔の可動範囲を調整します。変更はキャラクターへすぐ反映されます。": "Adjust display size and facial movement. Changes appear on the character immediately.",
    "キャラクターサイズ": "Character size",
    "左を向く幅": "Look-left range",
    "右を向く幅": "Look-right range",
    "上を向く幅": "Look-up range",
    "下を向く幅": "Look-down range",
    "動きの質感を詳しく調整": "Fine-tune motion",
    "速度と品質を詳しく調整": "Fine-tune speed and quality",
    "追従の速さ": "Follow speed",
    "呼吸の強さ": "Breathing strength",
    "体の傾き": "Body tilt",
    "上下の弾み": "Vertical bounce",
    "髪のしなり": "Hair spring",
    "髪の揺れ幅": "Hair movement",
    "このキャラに保存": "Save for this character",
    "初期設定へ戻す": "Restore defaults",
    "作成したキャラを削除": "Delete custom character",
    "動きと反応": "Motion and reactions",
    "自動まばたき、呼吸、髪揺れ、アプリ上のマウス追従、音量リップシンクを利用します。": "Uses automatic blinking, breathing, hair motion, in-app mouse tracking, and volume-based lip sync.",
    "マウスを目で追う": "Follow the mouse with eyes",
    "カーソルがキャラクター上にある間だけ追従": "Only while the pointer is over the character",
    "聞く・話す": "Listen and speak",
    "音声入力は全体へ、読み上げる声は選択中のキャラクターへ適用されます。": "Voice input applies globally; the reading voice applies to the selected character.",
    "音声設定内を移動": "Navigate voice settings",
    "キャラの声": "Character voice",
    "追加ランタイム": "Optional runtime",
    "マイクから話しかける方法と、自動送信のタイミングを設定します。": "Choose how to speak through the microphone and when transcripts are sent automatically.",
    "応答エンジン": "Response engine",
    "会話と作業を動かすAIを選びます。変更前に右上から接続を確認できます。": "Choose the AI that powers chat and work. Test the connection from the upper right before switching.",
    "AI接続設定内を移動": "Navigate AI connection settings",
    "接続方式": "Connection method",
    "接続を確認": "Test connection",
    "Codexのログイン状態を使う": "Use your Codex sign-in",
    "ローカルのCodex CLIを安全な読み取り専用モードで起動し、会話を継続します。": "Continues conversations through the local Codex CLI with protected access.",
    "自分のAPIキーを使う": "Use your own API key",
    "Responses APIを使います。APIキーはOSの暗号化ストレージからのみ復号します。": "Uses the Responses API. Your API key is decrypted only from the operating system's secure storage.",
    "Codex設定": "Codex settings",
    "会話と作業でモデルと推論の深さを分けられます。空欄ならCodex側の既定値です。": "Choose separate models and reasoning levels for chat and work. Blank fields use Codex defaults.",
    "モデル": "Model",
    "Codex既定": "Codex default",
    "推論の深さ": "Reasoning effort",
    "なし": "None",
    "最小": "Minimal",
    "低": "Low",
    "中": "Medium",
    "高": "High",
    "非常に高い": "Extra high",
    "最大": "Maximum",
    "作業": "Work",
    "深くするほど応答に時間がかかる場合があります。利用できる値はモデルによって異なります。": "Deeper reasoning can take longer. Available values depend on the model.",
    "ChatGPTでログイン": "Sign in with ChatGPT",
    "アカウント状態を確認しています…": "Checking account status…",
    "音声入力方式はデスクトップ設定で明示的に選択します。Codex Realtimeは選択した場合だけ接続します。": "Choose voice input explicitly in Desktop settings. Codex Realtime connects only when selected.",
    "OpenAI API設定": "OpenAI API settings",
    "APIキー未設定": "API key not set",
    "APIキー": "API key",
    "保存": "Save",
    "応答モデル": "Response model",
    "音声認識モデル": "Transcription model",
    "常駐と表示": "Display and behavior",
    "表示言語、キャラクターの操作方法、ウィンドウの位置をまとめて設定します。": "Configure display language, character interaction, and window placement in one place.",
    "デスクトップ設定内を移動": "Navigate desktop settings",
    "操作と表示": "Interaction & display",
    "ウィンドウ位置": "Window position",
    "表示言語": "Display language",
    "言語": "Language",
    "画面表示と組み込みキャラクターの名前・性格に適用します。音声認識と日本語TTS処理は変更しません。": "Applies to the interface and built-in character names and personalities. Speech recognition and Japanese TTS processing are unchanged.",
    "ウィンドウ": "Window",
    "常に最前面": "Always on top",
    "他のアプリより手前に表示": "Keep above other apps",
    "クリックを背面へ通す": "Click through to apps behind",
    "解除は Ctrl＋Shift＋L": "Toggle with Ctrl+Shift+L",
    "キャラクターの操作": "Character interaction",
    "常に操作できる": "Always interactive",
    "クリック・ドラッグ・チャットをいつでも使えます": "Click, drag, and chat at any time",
    "近づくと自動退避": "Auto-hide when approached",
    "キャラを薄くして、背面のアプリへクリックを通します": "Fades the character and lets clicks reach the app behind",
    "おすすめ": "Recommended",
    "固定して完全透過": "Locked and fully click-through",
    "常に背面を操作。Ctrl＋Shift＋Lで一時的に戻せます": "Always interact with apps behind. Restore temporarily with Ctrl+Shift+L",
    "位置をロック": "Lock position",
    "誤操作でキャラクターが動くのを防止": "Prevent accidental character movement",
    "画面端へ吸着": "Snap to screen edges",
    "近くまで移動すると端へ揃える": "Align to an edge when moved nearby",
    "PC起動時に開始": "Launch at startup",
    "Windows・macOSで有効": "Available on Windows and macOS",
    "音声入力": "Voice input",
    "音声入力方式": "Voice input method",
    "認識方式": "Recognition method",
    "GPT-Live / Codex Voice（実験的）": "GPT-Live / Codex Voice (experimental)",
    "sherpa-onnx（ローカル）": "sherpa-onnx (local)",
    "端末音声認識": "System speech recognition",
    "OpenAI文字起こし": "OpenAI transcription",
    "開始方法": "Activation",
    "VAD（発話と無音を自動検出）": "VAD (automatic speech and silence detection)",
    "ボタンで開始・停止": "Start and stop with button",
    "VAD感度": "VAD sensitivity",
    "低（ノイズの多い場所）": "Low (noisy spaces)",
    "標準": "Standard",
    "高（静かな場所）": "High (quiet spaces)",
    "認識後に自動送信": "Send automatically after recognition",
    "文字を一度表示してから送信します": "Shows the transcript before sending",
    "送信前にカウントダウン": "Countdown before sending",
    "認識結果を確認し、その場で送信・取消できます": "Review the transcript, then send now or cancel",
    "送信まで": "Time before sending",
    "1秒": "1 second",
    "1.5秒": "1.5 seconds",
    "2秒": "2 seconds",
    "3秒": "3 seconds",
    "5秒": "5 seconds",
    "今すぐ送信": "Send now",
    "取消": "Cancel",
    "自動送信を取り消しました。内容を編集できます": "Automatic sending was canceled. You can edit the transcript.",
    "キャラクター画面の音声ボタンに適用します。約0.6MBのSilero VADが声とノイズを判別し、話し終わりを自動検出します。準備できない場合だけ従来の音量検出へ戻ります。": "Applies to the character-window microphone. The small Silero VAD model distinguishes speech from noise and detects when you finish speaking.",
    "ローカル認識モデル": "Local recognition model",
    "内蔵音声モデルを確認しています…": "Checking bundled speech models…",
    "日本語モデルをダウンロード": "Download Japanese model",
    "モデルを削除": "Delete model",
    "選択したモデルを初回だけ取得します。認識処理と音声データは端末内で完結します。": "Downloads the selected model once. Recognition and audio stay on this device.",
    "キャラクターの声": "Character voice",
    "このキャラクター": "This character",
    "の音声": " voice",
    "選択中のキャラクターだけに、音声方式と声を保存します。": "Saves the voice method and voice for the selected character only.",
    "通常TTS": "Standard TTS",
    "現在の音声方式を確認中": "Checking current voice method",
    "設定を読み込んでいます。": "Loading settings.",
    "Realtimeの声": "Realtime voice",
    "Cove（標準）": "Cove (standard)",
    "Realtime用の音声一覧を確認しています…": "Checking Realtime voices…",
    "Realtime声変換": "Realtime voice conversion",
    "公式VST3とモデルは元の場所から参照します。キャラクターごとの声質は下の音声設定で選べます。": "The official VST3 and models stay in their original locations. Choose each character's voice below.",
    "最初にBeatrice 2をダウンロード": "Download Beatrice 2 first",
    "CharaDockにはBeatrice本体とモデルを同梱していません。公式サイトから取得・展開してから、下のフォルダーを選択してください。": "CharaDock does not bundle Beatrice or its models. Download and extract them from the official website, then choose the folder below.",
    "公式サイトを開く": "Open official website",
    "未設定": "Not set",
    "Beatrice本体": "Beatrice installation",
    "フォルダー未選択": "No folder selected",
    "公式サイトから取得したBeatrice 2の展開フォルダーを選択してください。": "Select the extracted Beatrice 2 folder downloaded from the official site.",
    "参照モデル": "Referenced models",
    "モデルファイルはコピー・削除しません": "Model files are neither copied nor deleted",
    "モデルを追加": "Add model",
    "モデルごとに利用条件が異なります。付属JVSモデルは許可のない営利利用が禁止されています。": "Terms vary by model. The bundled JVS model prohibits unauthorized commercial use.",
    "変換しない": "No conversion",
    "Beatrice 2（ネイティブ）": "Beatrice 2 (native)",
    "モデル未追加": "No models added",
    "ピッチ": "Pitch",
    "フォルマント": "Formant",
    "出力音量": "Output gain",
    "詳細設定": "Advanced settings",
    "入力音量": "Input gain",
    "イントネーション": "Intonation",
    "ピッチ補正": "Pitch correction",
    "補正方法": "Correction type",
    "標準値に戻す": "Reset to defaults",
    "Beatrice 2を確認しています…": "Checking Beatrice 2…",
    "Beatriceフォルダーを選択": "Choose Beatrice folder",
    "公式VST3とモデルはアプリへコピーせず、選択した場所から読み込みます。付属JVSモデルは許可のない営利利用が禁止されています。": "The official VST3 and model are loaded from the selected location and are not copied into the app. The bundled JVS model prohibits unauthorized commercial use.",
    "男性寄り・女性寄り・中性的は聞こえ方の目安です。OpenAI公式の性別分類ではなく、言語や話し方でも印象は変わります。Realtimeセッションは録音ボタンからのみ開始し、キャラクタークリックは表情と吹き出しだけで反応します。": "Masculine, feminine, and neutral are listening impressions, not official OpenAI gender classifications. Language and delivery can change the impression. Realtime sessions start only from the microphone button; clicking the character reacts with an expression and bubble only.",
    "AIの返答を音声で読み上げる": "Read AI responses aloud",
    "読み上げのON/OFFは全キャラクター共通です": "The speech on/off setting is shared by all characters",
    "音声方式": "Voice method",
    "Windows標準": "Windows system voice",
    "piper-plus（ローカル）": "piper-plus (local)",
    "Supertonic 3（ローカル）": "Supertonic 3 (local)",
    "Style-Bert-VITS2（API）": "Style-Bert-VITS2 (API)",
    "Style-Bert-VITS2 JP-Extra（WebGPU / CPU）": "Style-Bert-VITS2 JP-Extra (WebGPU / CPU)",
    "音声モデル": "Voice model",
    "AIVMXモデルを追加": "Add AIVMX model",
    "話者・スタイル": "Speaker and style",
    "スタイル強度（0–2）": "Style strength (0–2)",
    "JP-Extraモデルを確認しています…": "Checking JP-Extra models…",
    "AIVMXはアプリ内へコピーされます。初回生成時のみ日本語辞書と量子化DeBERTa（合計約250MB）を取得し、以後は端末内のキャッシュを使います。モデルごとの利用条件も確認してください。": "AIVMX files are copied into the app. The Japanese dictionary and quantized DeBERTa (about 250 MB total) are downloaded on first synthesis, then cached locally. Review each model's license terms.",
    "モデルID": "Model ID",
    "速度（0.5–2.0×）": "Speed (0.5–2.0×)",
    "サンプルモデルを確認しています…": "Checking sample model…",
    "サンプルをダウンロード": "Download sample",
    "声: つくよみちゃん。利用規約とクレジットを確認して初回だけ取得します。": "Voice: Tsukuyomi-chan. Review the terms and credits before the one-time download.",
    "つくよみちゃん音声のクレジット・利用条件": "Tsukuyomi-chan voice credits and terms",
    "本ソフトウェアの音声合成には、フリー素材キャラクター「つくよみちゃん」（© Rei Yumesaki）が無料公開している音声データを使用しています。": "Speech synthesis uses voice data published free of charge by the free-material character Tsukuyomi-chan (© Rei Yumesaki).",
    "つくよみちゃんコーパス（CV.夢前黎） · https://tyc.rei-yumesaki.net/material/corpus/": "Tsukuyomi-chan Corpus (CV: Rei Yumesaki) · https://tyc.rei-yumesaki.net/material/corpus/",
    "人への批判・攻撃、政治・宗教・思想への賛否の呼びかけ、強い表現のゾーニングなしの公開、素材としての二次利用を許す公開には使用できません。": "Do not use it to attack people, advocate political/religious/ideological positions, publish strong content without appropriate separation, or distribute it for reuse as source material.",
    "piper-plusの準備状況を確認しています…": "Checking piper-plus status…",
    "手動ファイルを使う": "Use manual files",
    "実行ファイル": "Executable",
    "未選択": "Not selected",
    "選択": "Choose",
    "音声モデル": "Voice model",
    "公式sherpa-onnx用int8モデルを初回だけ取得します。": "Downloads the official int8 model for sherpa-onnx once.",
    "声": "Voice",
    "生成ステップ（2–20）": "Generation steps (2–20)",
    "手動モデルを使う": "Use a manual model",
    "モデルフォルダー": "Model folder",
    "Supertonic 3の準備状況を確認しています…": "Checking Supertonic 3 status…",
    "日本語モデルを確認しています…": "Checking Japanese model…",
    "Kokoro 82Mの日本語5音声、WebGPU推奨FP32、CPU用q8モデル（合計約421MB）を初回だけ取得します。": "Downloads Kokoro 82M with five Japanese voices, a WebGPU FP32 model, and a CPU q8 model (about 421 MB total) once.",
    "Alpha（女性）": "Alpha (feminine)",
    "Gongitsune（女性）": "Gongitsune (feminine)",
    "Nezumi（女性）": "Nezumi (feminine)",
    "Tebukuro（女性）": "Tebukuro (feminine)",
    "Kumo（男性）": "Kumo (masculine)",
    "処理方法": "Processing method",
    "自動（WebGPU優先）": "Auto (prefer WebGPU)",
    "WebGPUのみ": "WebGPU only",
    "CPUのみ": "CPU only",
    "Kokoroの準備状況を確認しています…": "Checking Kokoro status…",
    "日本語G2Pと音声生成は端末内で完結します。WebGPUで失敗した場合、「自動」ではCPUへ切り替わります。": "Japanese G2P and speech generation stay on this device. Auto mode falls back to CPU if WebGPU fails.",
    "FP16モデルをダウンロード": "Download FP16 model",
    "Irodori TTS v4 Small · WebGPU": "Irodori TTS v4 Small · WebGPU",
    "V4モデルを確認しています…": "Checking the V4 model…",
    "V4モデルをダウンロード": "Download V4 model",
    "約1.7GBのFP16モデルを初回だけ取得し、SHA-256を検証して端末へ保存します。": "Downloads the roughly 1.7 GB FP16 model once, verifies its SHA-256 digests, and stores it on this device.",
    "V4 FP16モデル": "V4 FP16 model",
    "フォルダーを選択": "Choose folder",
    "irodori-tts-webgpuのルート、v4-small-unifiedフォルダー、または同じ配置の変換済みモデルを選択できます。": "Choose the irodori-tts-webgpu root, its v4-small-unified folder, or a converted model with the same layout.",
    "話者モード": "Speaker mode",
    "参照音声（Voice Clone）": "Reference voice (Voice Clone)",
    "参照なし（Voice Design）": "No reference (Voice Design)",
    "声・感情の指示（caption）": "Voice and emotion direction (caption)",
    "基本の声・話し方（caption）": "Base voice and speaking style (caption)",
    "会話内容に合わせて自動演技": "Automatically act to match the conversation",
    "表情判定と同じ結果を発話ごとのcaptionへ反映します。追加のAI推論は行いません。": "Applies the same emotion used for the character expression to each spoken caption, without an additional AI request.",
    "自動演技の強さ": "Automatic acting intensity",
    "控えめ": "Subtle",
    "自然（推奨）": "Natural (recommended)",
    "豊か": "Expressive",
    "落ち着いた親しみやすい声。自然な速さで明瞭に話す。": "A calm, friendly voice. Speak clearly at a natural pace.",
    "CFG実行": "CFG execution",
    "逐次（省VRAM・推奨）": "Sequential (lower VRAM, recommended)",
    "一括（高速・高VRAM）": "Batched (faster, more VRAM)",
    "必要なFP16ファイルだけ取得します。WebGPU対応GPUと約1.3GBの保存容量を使います。": "Downloads only the required FP16 files. Requires a WebGPU-capable GPU and about 1.3 GB of storage.",
    "参照音声": "Reference voice",
    "未追加": "None added",
    "音声を追加": "Add voice",
    "名前を変更": "Rename",
    "削除": "Delete",
    "WAV / MP3 / M4A / AAC / OGG / FLAC / WebMを48kHz WAVへ変換し、アプリ内へコピーします。元ファイルを削除しても使えます。": "Converts WAV, MP3, M4A, AAC, OGG, FLAC, or WebM to 48 kHz WAV and copies it into the app, so the original can be deleted.",
    "WAV / MP3 / M4A / AAC / OGG / FLAC / WebMを48kHz WAVへ変換し、アプリ内へコピーします。元ファイルを削除しても使えます。v4は最大120秒まで利用します。": "Converts WAV, MP3, M4A, AAC, OGG, FLAC, or WebM to 48 kHz WAV and copies it into the app. V4 uses up to 120 seconds, and the original can be deleted.",
    "再生速度（0.5–2.0×）": "Playback speed (0.5–2.0×)",
    "生成方式": "Generation method",
    "高速（Sway）": "Fast (Sway)",
    "互換（Linear）": "Compatible (Linear)",
    "生成ステップ（4–40）": "Generation steps (4–40)",
    "高速設定はSway 8ステップです。音質が合わない場合は10～12ステップ、またはLinearへ戻せます。": "Fast mode uses 8 Sway steps. If the quality does not fit, try 10–12 steps or switch back to Linear.",
    "シード": "Seed",
    "Irodori TTSの準備状況を確認しています…": "Checking Irodori TTS status…",
    "テキストと参照音声は端末内で処理されます。本人の許可がある声、または利用権を持つ音声だけを使用してください。": "Text and reference audio are processed on this device. Use only voices with the speaker's permission or appropriate usage rights.",
    "同梱参照音声のクレジット": "Bundled reference voice credits",
    "Hiro: ochisamu本人の録音・許諾音声": "Hiro: recorded and authorized by ochisamu",
    "Kohaku:": "Kohaku:",
    "あみたろの声素材工房": "あみたろの声素材工房 (Amitaro's Voice Material Workshop)",
    "の音声素材を使用しています。": ".",
    "利用規約": "Terms of use",
    "FP16モデル": "FP16 model",
    "英単語を日本語読みする": "Pronounce English words in Japanese",
    "ユーザー辞書とCMUdictの発音を読み上げ時だけ使用": "Use the user dictionary and CMUdict only for speech",
    "英単語のユーザー辞書": "English pronunciation dictionary",
    "1行に1件、英字=読み": "One entry per line: English=reading",
    "CharaDock=キャラドック\nFooBar=フーバー": "CharaDock=キャラドック\nFooBar=フーバー",
    "ユーザー辞書を最優先し、未登録語は技術用語辞書、略語、CMUdictの順で読みを決めます。表示文、URL、ファイル名は変更しません。": "The user dictionary has priority, followed by the technical-term dictionary, abbreviations, and CMUdict. Display text, URLs, and file names are unchanged.",
    "この音声を試す": "Test this voice",
    "キャラクターウィンドウ": "Character window",
    "表示するモニター": "Display",
    "メインモニター": "Primary display",
    "キャラクターを表示": "Show character",
    "一時的に隠す": "Hide temporarily",
    "− 小さく": "− Smaller",
    "＋ 大きく": "+ Larger",
    "画面右下へ戻す": "Reset to bottom right",
    "キャラクター本体をドラッグして移動できます。クリック透過中はドラッグできません。": "Drag the character to move it. Dragging is unavailable while click-through is on.",
    "初回セットアップをもう一度開く": "Run first-time setup again",
    "ショートカット": "Shortcuts",
    "どこからでも入力欄を開く": "Open input from anywhere",
    "設定を開く": "Open settings",
    "クリック透過を切替": "Toggle click-through",
    "キャラクター表示を切替": "Toggle character visibility",
    "ライセンス": "Licenses",
    "配布とクレジット": "Distribution and credits",
    "CharaDockは、Apache License 2.0のPuruPuru PNGTuberを基にした非公式派生アプリです。元開発者による公式製品ではありません。": "CharaDock is an unofficial derivative app based on PuruPuru PNGTuber under the Apache License 2.0. It is not an official product of the original developer.",
    "旧デモキャラクターと旧faviconは配布物に含めていません。画像を追加・公開するときは、アップロード・加工・配布に必要な権利を利用者自身で確認してください。": "The former demo character and favicon are not included. When adding or publishing images, confirm that you hold the rights required to upload, modify, and distribute them.",
    "同梱のKohaku参照音声には、": "The bundled Kohaku reference voice uses voice material from ",
    "同梱文書: LICENSE / NOTICE / MODIFICATIONS.md / DISTRIBUTION_ASSET_LICENSE.md / THIRD_PARTY_NOTICES.md": "Included documents: LICENSE / NOTICE / MODIFICATIONS.md / DISTRIBUTION_ASSET_LICENSE.md / THIRD_PARTY_NOTICES.md",
    "はじめに": "Welcome",
    "最初の3分セットアップ": "Three-minute setup",
    "あとで設定": "Set up later",
    "進行状況": "Progress",
    "1 · AI接続": "1 · AI Connection",
    "ChatGPTと接続": "Connect to ChatGPT",
    "AIと接続": "Connect AI",
    "ChatGPTログインを使うCodex app-server、または自分のOpenAI APIキーを選べます。": "Choose Codex app-server with ChatGPT sign-in, or use your own OpenAI API key.",
    "詳しいAI接続設定": "Advanced AI connection settings",
    "Codex app-serverはCodex CLIのChatGPTログインを使います。APIキーを画面へ渡しません。": "Codex app-server uses the Codex CLI's ChatGPT sign-in and does not expose an API key to the interface.",
    "ログイン状態を確認しています…": "Checking sign-in status…",
    "2 · キャラクター": "2 · Character",
    "最初のキャラクター": "Choose your first character",
    "同梱の4キャラから選べます。一枚絵からの追加はCodex Avatar Studioで行えます。": "Choose from four built-in characters. You can create another from one image in Codex Avatar Studio.",
    "＋ 自分の画像からキャラを追加": "+ Create from my image",
    "画像を追加する場合、その画像をアップロード・加工・利用する権利が必要です。生成処理では画像がCodexへ送信されます。": "You must have the rights to upload, modify, and use any image you add. Generation sends the image to Codex.",
    "3 · 音声": "3 · Voice",
    "声を確認": "Check the voice",
    "Windows標準の日本語音声でAIの返答を読み上げます。追加の音声API料金はありません。": "Reads AI responses with the standard Windows Japanese voice, with no additional speech API fees.",
    "音声読み上げを使う": "Read responses aloud",
    "後からデスクトップ設定で変更できます": "You can change this later in Desktop settings",
    "音声をテスト": "Test voice",
    "マイクを確認": "Check microphone",
    "詳しい音声設定": "Advanced voice settings",
    "モデルと声を設定": "Configure model and voice",
    "話しかける方法": "How to speak",
    "利用環境に合う認識方式を選び、マイクを使用できるか確認します。": "Choose a recognition method for your environment and verify microphone access.",
    "最初はWindows標準音声をすぐ使えます。ローカル音声モデルは後からダウンロードできます。": "The Windows system voice works immediately. Local voice models can be downloaded later.",
    "準備できました": "You're ready",
    "現在の設定はいつでも変更でき、このセットアップもサポート画面から再実行できます。": "You can change these settings anytime and rerun this setup from Support.",
    "セットアップ内容": "Setup summary",
    "確認中": "Checking",
    "会話を始める": "Start chatting",
    "戻る": "Back",
    "次へ": "Next",
    "依頼を許可": "Allow request",
    "やめる": "Cancel",
    "全文": "Full text",
    "会話モードと作業モードを切り替える": "Switch between chat and work mode",
    "ChatとWorkを切り替える": "Switch between Chat and Work",
    "作業先フォルダーを変更する": "Change work folder",
    "作業先フォルダーを開く": "Open work folder",
    "履歴": "History",
    "履歴を開く": "Open history",
    "メッセージ": "Message",
    "短く話しかける…": "Say something…",
    "応答を中断": "Stop response",
    "フォローアップを差し込む": "Insert a follow-up",
    "会話入力を開く": "Open chat input",
    "会話と作業の記録": "Chat and work history",
    "ChatとWorkの記録": "Chat and Work history",
    "作業履歴を閉じる": "Close work history",
    "キャラクターに触れる": "Interact with character",
    "ドラッグで移動・クリックで触れる": "Drag to move; click to interact",
    "回答中です。差し込む場合は入力欄から送信できます": "A response is in progress. Send from the input field to add a follow-up.",
    "読み上げを停止しました": "Stopped speaking",
    "作業履歴": "Work history",
    "会話履歴": "Chat history",
    "Work履歴": "Work history",
    "Chat履歴": "Chat history",
    "まだ作業履歴はありません": "No work history yet",
    "このキャラクターとの会話はまだありません": "No conversations with this character yet",
    "作業中": "Working",
    "中断中": "Stopping",
    "完了": "Completed",
    "エラー": "Error",
    "キャラクター": "Character",
    "あなた": "You",
    "作業内容なし": "No work request",
    "中断しています…": "Stopping…",
    "会話モードへ戻す": "Switch to chat mode",
    "作業モードへ切り替える": "Switch to work mode",
    "Chatへ戻す": "Switch to Chat",
    "Workへ切り替える": "Switch to Work",
    "未選択": "Not selected",
    "このフォルダーでやること…": "What should I do in this folder?",
    "作業履歴を開く": "Open work history",
    "会話履歴を開く": "Open chat history",
    "会話履歴を閉じる": "Close chat history"
    ,"Work履歴を開く": "Open Work history"
    ,"Chat履歴を開く": "Open Chat history"
    ,"Work履歴を閉じる": "Close Work history"
    ,"Chat履歴を閉じる": "Close Chat history"
    ,"ChatとWorkの履歴": "Chat and Work history"
    ,"中性的": "Neutral"
    ,"女性寄り": "Feminine"
    ,"男性寄り": "Masculine"
    ,"気さくで万能": "Friendly and versatile"
    ,"活発で誠実": "Energetic and sincere"
    ,"落ち着いて率直": "Calm and direct"
    ,"自信があり前向き": "Confident and positive"
    ,"開放的で明るい": "Open and bright"
    ,"陽気で率直": "Cheerful and candid"
    ,"聡明でリラックス": "Smart and relaxed"
    ,"穏やかで肯定的": "Gentle and affirming"
    ,"明るく好奇心旺盛": "Bright and curious"
    ,"モデルを展開しています…": "Extracting model…"
    ,"日本語音声モデルはまだダウンロードされていません。": "The Japanese speech model has not been downloaded yet."
    ,"サンプルモデルはまだダウンロードされていません。": "The sample model has not been downloaded yet."
    ,"このサンプルの自動導入はWindows版で利用できます。": "Automatic sample installation is available on Windows."
    ,"会話スタイルを設定できます": "Conversation style can be customized"
    ,"読込": "Imported"
    ,"作成済み": "Created"
    ,"呼び名": "Preferred name"
    ,"好み": "Preference"
    ,"関係性": "Relationship"
    ,"目標": "Goal"
    ,"背景": "Background"
    ,"その他": "Other"
    ,"まだメモリはありません。普段どおり会話すると、今後も役立つ好みや呼び名をこのキャラだけが自動で覚えます。": "No memories yet. As you chat normally, this character will remember useful preferences and names for future conversations."
    ,"まだメモリはありません。会話から自動で覚える機能はCodex app-server接続で利用できます。": "No memories yet. Automatic learning from conversations is available with Codex app-server."
    ,"セットアップ完了": "Finish setup"
    ,"音声モデルは未導入です。後から選択できます。": "No voice model is installed. You can choose one later."
    ,"ローカル音声合成の準備ができています。": "Local speech synthesis is ready."
    ,"Supertonic 3のローカル音声合成を利用できます。": "Supertonic 3 local speech synthesis is available."
    ,"モデルは未導入です。後からフォルダーを選択できます。": "No model is installed. You can choose a folder later."
    ,"Kokoroの日本語モデルは未導入です。": "The Kokoro Japanese model is not installed."
    ,"このPCではWebGPUを利用できません。自動またはCPUを選んでください。": "WebGPU is unavailable on this PC. Choose Auto or CPU."
    ,"KokoroをWebGPUで利用できます。初回生成時にモデルをGPUへ読み込みます。": "Kokoro can use WebGPU. The model loads onto the GPU on first generation."
    ,"Kokoroを利用できます。WebGPUが使えない場合はCPUへ自動で切り替わります。": "Kokoro is available and will fall back to CPU if WebGPU cannot be used."
    ,"KokoroをCPUで利用できます。": "Kokoro can use the CPU."
    ,"WebGPUを利用できません。GPUドライバーを確認してください。": "WebGPU is unavailable. Check your GPU driver."
    ,"FP16モデルは未導入です。後からフォルダーを選択できます。": "The FP16 model is not installed. You can choose a folder later."
    ,"本人の許可がある参照音声を追加してください。": "Add a reference voice with the speaker's permission."
    ,"Irodori TTSのWebGPU音声合成を利用できます。": "Irodori TTS WebGPU speech synthesis is available."
    ,"Irodori TTS v4 SmallのFP16モデルフォルダーを選択してください。": "Choose an Irodori TTS v4 Small FP16 model folder."
    ,"Irodori TTS v4 SmallのWebGPU音声合成を利用できます。": "Irodori TTS v4 Small WebGPU speech synthesis is available."
    ,"V4モデルと音声設定を確認しました。初回生成時にWebGPUを確認します。": "The V4 model and voice settings are ready. WebGPU will be checked on first generation."
    ,"モデルと参照音声を確認しました。初回生成時にWebGPUを確認します。": "Model and reference voice are ready. WebGPU will be checked on first generation."
    ,"自動（メインモニター）": "Auto (primary display)"
    ,"OpenAI Responses APIを使用します。": "Using OpenAI Responses API."
    ,"アカウント確認中": "Checking account"
    ,"APIキー設定済み": "API key configured"
    ,"接続済み": "Connected"
    ,"ChatGPTにログインしていません。": "Not signed in to ChatGPT."
    ,"ChatGPT未ログイン": "Not signed in to ChatGPT"
    ,"再確認": "Check again"
    ,"接続を確認できません": "Unable to verify connection"
    ,"ChatGPTログインを確認しました。": "ChatGPT sign-in confirmed."
    ,"話してください…": "Start speaking…"
    ,"聞き取っています…": "Listening…"
    ,"Codexが考えています…": "Codex is thinking…"
    ,"考え中": "Thinking"
    ,"応答を待っています…": "Waiting for a response…"
    ,"Codexから応答しました。": "Received a response from Codex."
    ,"OpenAI APIから応答しました。": "Received a response from the OpenAI API."
    ,"応答を中断しました。続けて修正できます。": "Response stopped. You can send a correction."
    ,"応答を中断しました。": "Response stopped."
    ,"画像を読み込んでいます…": "Loading image…"
    ,"中断しています…": "Stopping…"
    ,"新しい会話を始めよう。何を話す？": "Let's start a new conversation. What would you like to talk about?"
    ,"保存して会話へ反映しました。": "Saved and applied to conversations."
    ,"初期設定へ戻しました。": "Defaults restored."
    ,"このキャラのメモリから削除しました。": "Removed from this character's memories."
    ,"接続を確認しています…": "Checking connection…"
    ,"起動エラー": "Startup error"
    ,"作業を実行しています": "Work is in progress"
    ,"今回だけ許可してもいい？": "Allow this request once?"
    ,"今回だけ見る": "View once"
    ,"操作を許可": "Allow control"
    ,"ブラウザを許可": "Allow browser"
    ,"閉じる": "Close"
    ,"画面を1枚だけ取得しています…": "Capturing one screenshot…"
    ,"Windows操作を準備しています…": "Preparing Windows control…"
    ,"コンピューター操作を準備しています…": "Preparing computer control…"
    ,"専用ブラウザを準備しています…": "Preparing the dedicated browser…"
    ,"画面を確認しました": "Screen checked"
    ,"Windows操作が完了しました": "Windows task completed"
    ,"コンピューター操作が完了しました": "Computer task completed"
    ,"ブラウザ確認が完了しました": "Browser task completed"
    ,"作業を開始…": "Starting work…"
    ,"考え中…": "Thinking…"
    ,"作業を中断しました": "Work stopped"
    ,"送信できませんでした": "Could not send"
    ,"音声入力は詳細画面で利用できます": "Voice input is available in the full window"
    ,"音声待機を停止": "Stop voice standby"
    ,"音声待機中…そのまま話してください": "Voice standby… start speaking"
    ,"音声を入力しました": "Voice input added"
    ,"作業を開始しています": "Starting work"
    ,"作業中…": "Working…"
    ,"作業完了": "Work completed"
    ,"作業を完了できませんでした": "Could not complete the work"
  });

  const PATTERNS = Object.freeze([
    [/^(.+)のプレビュー$/, "$1 preview"],
    [/^(.+)に切り替えました。$/, "Switched to $1."],
    [/^(.+)の設定$/, "$1 settings"],
    [/^作業先[ ·:：]+(.+)$/, "Work folder · $1"],
    [/^(\d+)件を保持$/, "$1 saved"],
    [/^(\d+)往復を保持$/, "$1 exchanges saved"],
    [/^進捗履歴（(\d+)件）$/, "Progress history ($1)"],
    [/^エラー[:：]\s*(.+)$/, "Error: $1"],
    [/^起動エラー[:：]\s*(.+)$/, "Startup error: $1"],
    [/^(.+)を削除しました。$/, "Deleted $1."],
    [/^(.+)でログイン済み$/, "Signed in with $1"],
    [/^モデルをダウンロードしています…\s*(\d+)%\s*(.*)$/, "Downloading model… $1% $2"],
    [/^ダウンロード（約(.+)）$/, "Download (about $1)"],
    [/^(.+) · 利用できます$/, "$1 · Available"],
    [/^(.+) · 導入済み$/, "$1 · Installed"],
    [/^(.+)（保存済み）$/, "$1 (saved)"],
    [/^(.+)（声の印象）$/, "$1 (voice impression)"],
    [/^(\d+)種類のRealtime音声を利用できます。$/, "$1 Realtime voices available."],
    [/^モデル一覧を取得できません[:：]\s*(.+)$/, "Could not retrieve model list: $1"],
    [/^音声一覧を取得できません[:：]\s*(.+)$/, "Could not retrieve voice list: $1"],
    [/^切り替えられませんでした[:：]\s*(.+)$/, "Could not switch: $1"],
    [/^メモリ「(.+)」を削除$/, "Delete memory “$1”"],
    [/^モデルファイルが不足しています（(\d+)件）。$/, "$1 model files are missing."],
    [/^APIキー設定済み（(.+)）$/, "API key configured ($1)"],
    [/^Codex CLIを確認できません[:：]\s*(.+)$/, "Could not verify Codex CLI: $1"],
    [/^音声入力[:：]\s*(.+)$/, "Voice input: $1"],
    [/^(.+)で生成しています…$/, "Generating with $1…"],
    [/^(.+)から音声データが返されませんでした。音声出力がONか確認してください。$/, "$1 returned no audio. Check that voice output is enabled."],
    [/^(.+) を確認しています…$/, "Checking $1…"],
    [/^(.+) を使用します。$/, "Using $1."],
    [/^作業先[:：]\s*(.+)$/, "Work folder: $1"],
    [/^([0-9.]+)秒後に送信$/, "Sending in $1s"],
  ]);

  function translateText(value, language = "ja") {
    const source = String(value ?? "");
    if (language !== "en") return source;
    if (Object.prototype.hasOwnProperty.call(ENGLISH, source)) return ENGLISH[source];
    for (const [pattern, replacement] of PATTERNS) {
      if (pattern.test(source)) return source.replace(pattern, replacement);
    }
    return source;
  }

  const api = { translateText, translations: ENGLISH };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (!root || typeof root.document === "undefined") return;

  const textSources = new WeakMap();
  const attributeSources = new WeakMap();
  let activeLanguage = "ja";
  let translating = false;
  const attributes = ["placeholder", "aria-label", "title"];

  function translatedWhitespace(value, language) {
    const match = String(value).match(/^(\s*)(.*?)(\s*)$/s);
    return `${match[1]}${translateText(match[2], language)}${match[3]}`;
  }

  function translateNode(node) {
    if (node.nodeType === 3) {
      let source = textSources.get(node);
      if (!source || node.nodeValue !== source.rendered) source = { original: node.nodeValue, rendered: node.nodeValue };
      source.rendered = translatedWhitespace(source.original, activeLanguage);
      textSources.set(node, source);
      if (node.nodeValue !== source.rendered) node.nodeValue = source.rendered;
      return;
    }
    if (node.nodeType !== 1) return;
    let sources = attributeSources.get(node);
    if (!sources) {
      sources = new Map();
      attributeSources.set(node, sources);
    }
    for (const name of attributes) {
      if (!node.hasAttribute(name)) continue;
      const current = node.getAttribute(name);
      const previous = sources.get(name);
      const original = previous && current === previous.rendered ? previous.original : current;
      const rendered = translateText(original, activeLanguage);
      sources.set(name, { original, rendered });
      if (current !== rendered) node.setAttribute(name, rendered);
    }
    for (const child of node.childNodes) translateNode(child);
  }

  function apply() {
    translating = true;
    translateNode(document.documentElement);
    document.documentElement.lang = activeLanguage;
    translating = false;
  }

  api.setLanguage = (language) => {
    activeLanguage = language === "en" ? "en" : "ja";
    document.documentElement.dataset.uiLanguage = activeLanguage;
    apply();
  };
  api.getLanguage = () => activeLanguage;
  root.CharaDockI18n = api;

  const observer = new MutationObserver((records) => {
    if (translating) return;
    translating = true;
    for (const record of records) {
      if (record.type === "characterData") translateNode(record.target);
      else if (record.type === "attributes") translateNode(record.target);
      else for (const node of record.addedNodes) translateNode(node);
    }
    translating = false;
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
  api.setLanguage(document.documentElement.dataset.uiLanguage || "ja");
})(typeof window !== "undefined" ? window : null);
