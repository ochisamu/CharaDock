# CharaDock 0.7.1

Chat／WorkでGPT-6 Sol・GPT-6 Lunaを選択できるようにしたメンテナンスリリースです。

## 主な変更

- Codexモデル選択にGPT-6 SolとGPT-6 Lunaを追加。古いCodexのモデル一覧に含まれない場合も選択できます（利用にはアカウント側のモデルアクセス権が必要です）。
- 既定はGPT-6 Astraのまま、保存済みのモデル選択を維持します。
- モデル候補の重複を防ぎ、Chat／Work両方の回帰テスト・スモークテストを更新しました。

## ダウンロード

- **Windows x64**: `CharaDock.Setup.0.7.1.exe`（インストーラー）／`CharaDock.0.7.1.exe`（ポータブル）
- **Microsoft Store提出用**: `CharaDock-0.7.1.0-store-x64-unsigned.msix`
- **macOS Apple Silicon / arm64（実験版）**: `CharaDock-0.7.1-mac-arm64.dmg`／`CharaDock-0.7.1-mac-arm64.zip`
- SHA-256: `SHA256SUMS.txt`、`SHA256SUMS-store-v0.7.1.txt`、`SHA256SUMS-macos-arm64.txt`

ESP32側も [v0.7.1](https://github.com/ochisamu/CharaDock-ESP32/releases/tag/v0.7.1) を公開します。ファームの機能はv0.7.0から変更していないため、今回のモデル追加のために実機を書き換える必要はありません。

## 注意

Windows配布物は未署名です。MSIXはStore提出用で、添付はMicrosoft Storeの審査・公開完了を意味しません。Mac版はリリースタグからGitHub Actionsでビルドした未署名・未公証のarm64実験版で、Mac実機検証を意味しません。StackChanも実験的対応です。

APIキー、個人profile、会話ログ、ダウンロード型音声モデルは配布物に含めません。音声認識・合成と任意のJev判定はPC側で行います。Jevの呼びかけ判定は誤作動を完全に防ぐ機能ではないため、会議中はミュートしてください。

[README](https://github.com/ochisamu/CharaDock#readme) · [Full changelog](https://github.com/ochisamu/CharaDock/compare/v0.7.0...v0.7.1)

---

## English

This maintenance release adds GPT-6 Sol and GPT-6 Luna to both Chat and Work Codex model selectors, including fallback entries for older model lists. GPT-6 Astra remains the default and saved selections are preserved. Duplicate model entries are avoided and regression/smoke tests cover all three models. Account access is still required.

Downloads include Windows installer/portable, unsigned Store-submission MSIX and experimental unsigned/unnotarized macOS arm64 DMG/ZIP built in GitHub Actions. Store publication and Mac hardware validation are not implied. Verify the corresponding SHA-256 manifests.

Companion ESP32 v0.7.1 contains a version-only update; reflashing v0.7.0 devices is not required for the new PC model options. Private profiles, credentials, conversation logs and downloadable speech models are not bundled.
