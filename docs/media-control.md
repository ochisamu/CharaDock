# PCの音楽をキャラから操作する

Windows 10 1809以降のSystem Media Transport Controls対応プレイヤーが対象です。
Codex接続のChat／Workに組み込みツール `media_control` を提供します。
デスクトップ入力・設定チャット・リモートは既存の共通会話経路を使います。
Liveは既存のCodexハンドオフで同じツールを呼ぶ設計です。
通常のOpenAI APIバックエンド、macOS、スマホ自体のプレイヤーは対象外です。

## 話しかけ方

- 「音楽を止めて」：再開できる一時停止
- 「音楽を再開して」
- 「次の曲にして」「前の曲に戻して」
- 「今流れている曲は何？」
- 複数アプリが再生している場合：「Spotifyのほうを止めて」など、確認に答える

新しい曲を検索して再生する機能ではありません。曲送りなどの対応はプレイヤー次第です。
Chatの書き込み権限を広げず、明示的に依頼された既存メディアの操作だけを例外として扱います。
音楽の停止と、キャラの読み上げ停止・Workの中断は別です。

## 仕組みと安全性

- `desktop/lib/media-control.cjs`：限定された操作、対象選択、重複抑止、直列化。
- `desktop/lib/windows-media.ps1`：Windows標準WinRT APIを固定スクリプトから呼ぶブリッジ。
- PowerShellは非表示・非同期、12秒上限。ユーザーの文字列をコマンドとして展開せず、JSON stdinで渡す。
- 一意な再生中セッションを優先。複数再生中、同じアプリIDの複数タブ、消えた対象は勝手に選ばない。
- 操作の直前にも対象・曲のメタデータを再確認。別タブへの切替などは `session-changed` として拒否。
- CharaDock／Electron自身とCharaDock Linkのタイトルを除外。OSメディアキーによる一括操作にはフォールバックしない。
- 再生アプリの受理結果を返す。拒否・非対応・タイムアウトを成功と扱わず、曲送りを自動再試行しない。
- 起動時の監視や収集は行わない。曲情報は質問時だけ取得し、聴取履歴を独自保存しない。
  ただし、回答した曲名等は通常の会話履歴に含まれ、応答生成のためCodexへ渡される。

## Store

手動Storeマニフェストに `uap7:Capability Name="globalMediaControl"` を追加しています。
これは `rescap` ではありません。既存のrunFullTrust宣言は維持しています。
今回、MSIX再ビルド・提出・インストール済みアプリの更新はしていません。

公式仕様：
- https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager
- https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession
- https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations

## 検証

単体テストは `node --test desktop/tests/media-control.test.cjs`。
Windows実機ではセッション一覧取得と、存在しない対象の拒否のみ確認。
ユーザーの録画を守るため、起動中profileの再起動・実際の停止／再開／曲送りは未実施。

録画終了後に確認する項目：
1. 通常profileの次回起動後、対応プレイヤーで停止→再開→次曲→前曲、曲名回答。
2. デスクトップ／設定チャット／リモート、Chat／Work、TTS／Liveで同じ操作結果を確認。
3. 複数プレイヤーを開いた状態で対象確認。キャラ自身のTTSは止まらないこと。
4. Liveではハンドオフ後の返答が一度だけ発話され、成功前に完了を宣言しないこと。
5. MSIX環境でもメディアAPIへアクセスできること。
