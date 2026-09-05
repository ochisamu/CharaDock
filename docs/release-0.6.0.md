# CharaDock 0.6.0

RLCD 4.2のキャラクター表示・音声会話に対応し、ESP32との接続、音声入力、読み上げ字幕、失敗時の復帰を改善したリリースです。

## 主な変更

- RLCD 4.2対応：キャラ表示、口パク・瞬き、時計・環境表示、マイク・スピーカー。
- USB優先の自動接続とWi-Fiへの切り替え。充電は従来どおりです。
- 通常会話のESP32音声入力にPC側Sileroゲートを追加。物音候補では時計表示を維持します。
- 読み上げ中の文に合わせた字幕と、直近2チャンクの表示。終了した字幕の再表示を抑制。
- 音声入力・再生失敗後の復帰、転送タイムアウト、EPIPEクラッシュを修正。
- Codex Chat/Workの既定モデルをGPT-6 Astraへ変更。利用にはアカウント側のアクセス権が必要です。

## ダウンロード

- **Windows x64**: `CharaDock.Setup.0.6.0.exe`（インストーラー）
- **Windows x64**: `CharaDock.0.6.0.exe`（ポータブル）
- **Microsoft Store提出用**: `CharaDock-0.6.0.0-store-x64-unsigned.msix`
- **macOS Apple Silicon / arm64（実験版）**: `CharaDock-0.6.0-mac-arm64.dmg` / `CharaDock-0.6.0-mac-arm64.zip`
- SHA-256: EXEは`SHA256SUMS.txt`、MSIXは`SHA256SUMS-store-v0.6.0.txt`、Mac版は`SHA256SUMS-macos-arm64.txt`で確認できます。

ESP32利用時は [CharaDock-ESP32 v0.6.0](https://github.com/ochisamu/CharaDock-ESP32/releases/tag/v0.6.0)
を併用してください。音声認識・合成はPC側で行い、端末へモデルやsanoTTSは搭載しません。

## 注意

> 通常のWindowsパッケージは未署名です。OSが警告を表示する場合があります。MSIXはMicrosoft Store提出用の未署名パッケージで、一般的なサイドロード用途ではありません。このReleaseへの添付は、Microsoft Storeでの公開完了を意味しません。

> macOS版は未署名・未公証の実験版です。リリースタグを指定したGitHub Actionsでビルドし、arm64のネイティブホスト同梱とチェックサムを検証しています。Mac実機でのGUI・音声・ESP32接続の動作確認を意味するものではありません。

物音判定や認識精度は環境に依存し、すべてのノイズを除外する保証はありません。
モデル・認証情報・会話ログはこのリリースの配布物には含めません。

ソースの開発用依存（electron-builder配下のfast-uri / xmldom）には公開時点で
GitHubの脆弱性警告が残っています。該当2パッケージが配布アプリに含まれないことは
確認済みですが、ソースからビルドする際は開発環境側の警告にも注意してください。

デスクトップ750件・Python 58件のテスト、Windowsパッケージ起動試験、GitHub CIを通過しています。

[README](https://github.com/ochisamu/CharaDock#readme) · [ESP32ガイド](https://github.com/ochisamu/CharaDock/blob/main/docs/atom-echo-mvp.md) · [Website](https://ochisamu.github.io/CharaDock/) · [Full changelog](https://github.com/ochisamu/CharaDock/compare/v0.5.1...v0.6.0)

---

This release adds RLCD 4.2 character display and voice conversations, with improvements to ESP32 connectivity, speech detection, synchronized captions, and recovery from audio failures.

## Highlights

- **RLCD 4.2 support** — Character portraits, lip sync, blinking, clock and environment views, microphone input, and speaker playback.
- **USB-first automatic connectivity** — Prefers USB when connected, with Wi-Fi fallback.
- **PC-side Silero speech gate** — Screens normal ESP32 voice input before starting a conversation; noise candidates keep the clock view unchanged. Detection accuracy depends on the environment.
- **Synchronized captions** — Shows the current and recent speech chunks and prevents expired captions from reappearing.
- **Conversation recovery** — Fixes EPIPE crashes, bounds audio-transfer waits, and restores operation after input or playback failures.
- **Codex defaults** — GPT-6 Astra is the default for Chat and Work, subject to account access.

Use [CharaDock-ESP32 v0.6.0](https://github.com/ochisamu/CharaDock-ESP32/releases/tag/v0.6.0) with this application. Speech recognition and synthesis run on the PC; ESP32 firmware does not include sanoTTS or speech models.

## Downloads

- **Windows x64**: `CharaDock.Setup.0.6.0.exe` (installer)
- **Windows x64**: `CharaDock.0.6.0.exe` (portable)
- **Microsoft Store submission**: `CharaDock-0.6.0.0-store-x64-unsigned.msix`
- **macOS Apple Silicon / arm64 (experimental)**: `CharaDock-0.6.0-mac-arm64.dmg` / `CharaDock-0.6.0-mac-arm64.zip`
- Verify EXEs with `SHA256SUMS.txt`, the MSIX with `SHA256SUMS-store-v0.6.0.txt`, and Mac packages with `SHA256SUMS-macos-arm64.txt`.

> Regular Windows packages are unsigned. The unsigned MSIX is for Microsoft Store submission, not normal sideloading. Attaching it here does not mean the update has been published to Microsoft Store. Downloadable speech models, credentials, and conversation logs are not bundled.

> The macOS package is experimental, unsigned, and unnotarized. It is built from the release tag using GitHub Actions, with bundled arm64 native-host and checksum verification. This does not constitute hardware validation of the Mac GUI, audio, or ESP32 connectivity.

There are outstanding GitHub security advisories for development-only fast-uri / xmldom dependencies under electron-builder. Neither package is included in the packaged application; source builders should still review these development-environment warnings.

Validation includes 750 desktop tests, 58 Python tests, a packaged Windows smoke test, and GitHub CI.
