# CharaDock 0.7.0

Jevによる音楽操作・キャラクター表現・ハンズフリーの呼びかけ判定を追加し、音声会話とESP32連携を改善しました。

## 主な変更

- Jevを任意で有効化し、アプリ内でAPIキーを設定できます。音楽の次曲・前曲・再生・停止を判定します。
- キャラクターの表情選択を追加。AIニケちゃんには表情・身振りの拡張を用意し、発話タイミングとの同期を改善しました。
- 通常TTSのPC・ATOM・RLCDハンズフリーにJev呼びかけ判定を追加。既存VADは維持し、文字起こし後に判定します。標準／厳しめを選べ、挨拶や短い返事と、不明瞭な音声断片を区別します。既定はOFF、Liveは対象外です。
- PC操作時の音声出力先、RLCDの長文読み上げ・字幕・再生状態の取り扱いを改善しました。
- ESP32側にはRLCDの会議用ミュート、再生中表示、USB音声転送の改善と、StackChanのWi-Fi・会話機能の実装を含みます。

## ダウンロード

- **Windows x64**: `CharaDock.Setup.0.7.0.exe`（インストーラー）／`CharaDock.0.7.0.exe`（ポータブル）
- **Microsoft Store提出用**: `CharaDock-0.7.0.0-store-x64-unsigned.msix`
- **macOS Apple Silicon / arm64（実験版）**: `CharaDock-0.7.0-mac-arm64.dmg`／`CharaDock-0.7.0-mac-arm64.zip`
- SHA-256: `SHA256SUMS.txt`、`SHA256SUMS-store-v0.7.0.txt`、`SHA256SUMS-macos-arm64.txt`

ESP32は [CharaDock-ESP32 v0.7.0](https://github.com/ochisamu/CharaDock-ESP32/releases/tag/v0.7.0) を併用してください。音声認識・合成はPC側で行い、ESP32にsanoTTSや音声モデルは含めません。

## 注意

Windows配布物は未署名です。MSIXはStore提出用で通常のサイドロード向けではありません。このReleaseへの添付はMicrosoft Storeの審査・公開完了を意味しません。

Mac版はリリースタグを指定したGitHub Actionsでビルドする、未署名・未公証のarm64実験版です。Mac実機でのGUI・音声・ESP32接続検証を意味しません。StackChanも実験的対応です。

Jev有効時は用途に応じた会話テキストがJevへ送られます。呼びかけ判定では認識文と直近回答の一部を使用します。文字からの判定なので、咳の誤認識やテレビ音声を完全に除外できません。会議中はミュートしてください。APIキー、個人profile、会話ログ、ダウンロード型音声モデルは配布物に含めません。

[README](https://github.com/ochisamu/CharaDock#readme) · [Full changelog](https://github.com/ochisamu/CharaDock/compare/v0.6.0...v0.7.0)

---

## English

This release adds optional Jev-powered music control, avatar expressions and hands-free addressee filtering, plus improvements to speech playback and ESP32 integration.

- Configure your own Jev API key in the app. AI Nike includes expanded expressions and body performances.
- Normal-TTS hands-free input on PC, ATOM and RLCD retains existing VAD, then classifies transcribed speech. Standard and strict modes distinguish greetings/replies from non-conversational fragments. Disabled by default; Live is not filtered.
- Improvements to PC audio routing, long RLCD speech, captions and playback status. Companion firmware includes RLCD meeting mute and experimental StackChan Wi-Fi conversation support.

Downloads above include Windows x64 installer/portable, unsigned Store-submission MSIX, and experimental macOS arm64 DMG/ZIP built from the release tag in GitHub Actions. Check the corresponding SHA-256 manifests. Neither Store publication nor macOS hardware validation is implied. Windows packages are unsigned; Mac packages are unsigned and unnotarized.

Jev features send relevant text to Jev. The addressee filter is not speaker authentication or a guarantee against unwanted activation; explicitly mute during meetings. Credentials, private profiles, conversation logs and downloadable speech models are not bundled.

Use with [CharaDock-ESP32 v0.7.0](https://github.com/ochisamu/CharaDock-ESP32/releases/tag/v0.7.0).
