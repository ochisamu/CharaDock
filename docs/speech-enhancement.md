# 音声入力のノイズ低減（RE-USE）

speech.cpp 0.10.1のNVIDIA NemotronLabs RE-USEを、ローカル音声認識の任意の前処理として使う。Windows版はVulkanで動き、CUDAは不要。既存の音声合成も0.10.1へ更新し、旧0.8.3 workerとの互換性は維持する。

## 使い方

設定 → 音声 → マイクと認識 → ノイズ低減でモデルを追加し、「音声入力のノイズを減らす」をONにする。初期値はOFF。モデルとエンジンは約68 MBで、SHA-256を検証してプロフィールのspeech-enhancement-modelsへ保存する。

- 対象はストリーミングのローカル認識とsherpa-onnx。設定チャット、キャラクター入力、CharaDock Link経由のローカル認識、同じ共有認識処理を使うデバイス入力に適用する。
- 途中認識とVADは元音声を使う。発話終了時の確定処理だけをRE-USEへ渡す。
- 確定した認識テキストをJev／Decisionsの呼びかけ・音楽操作などの判断へ渡す。これらの判断サービスへ音声を直接送るわけではない。途中認識とVADへの適用はない。
- Codex Liveと端末標準の音声認識には適用しない。LinkでもLive／スマホ標準の認識を選ぶ場合は対象外。
- RE-USEは聞きやすい音声への修復モデルで、認識精度の改善を保証しない。不要な音と一緒に声の一部を除く場合があるため、用途に応じてOFFと比較する。
- エンジンは共有の常駐workerを再利用し、アイドル時に終了する。中止・設定切り替え・アプリ終了で未完了の結果を破棄する。最終認識中のセッションも中止できる。

## エンジン更新

MF・Smallそれぞれの管理対象モデルを0.10.1の別ディレクトリーへ導入する。既存のGGUFとライセンス文書はハッシュ一致後に再利用し、旧版を自動削除しない。起動時は既知の管理対象パスだけを移行し、ユーザー指定の独自パス、キャラクターの声、モデル選択、モデル別Step数は維持する。

RE-USEモデルはsakasegawa/NVIDIA-NemotronLabs-RE-USE-GGUFの117011d06bba5522006f5fcfeadfdb714b58b236に固定。OpenMDW 1.1のライセンスとモデルカードを併せて保存する。旧nvidia/RE-USEの非商用チェックポイントを使わない。

## 検証

RTX 5060 Ti 16 GB、Windows、Vulkan、16 kHz mono。3.84秒の日本語合成音声へ決定的な白色ノイズを5 dB SNRで加えた試験。実マイク・車内音や話者全体についての性能を示すものではない。

| 処理 | 結果 |
| --- | --- |
| RE-USE初回、worker準備を含む | 4,277 ms |
| RE-USE読み込み後 | 412 ms（推論410 ms） |
| 出力の長さ | 入力と同じ61,440 samples |
| 既存ReazonSpeechでの認識 | clean/noisy/enhancedとも同じ非空の結果 |
| Irodori MF / Small | 0.10.1で合成・PCM終端検証を完了 |
| 旧0.8.3との比較 | 同じMF設定の音声で同じ認識結果。波形のビット一致は主張しない |
| 実画面 | ON/OFFの保存、確定時だけの適用、設定チャットとキャラクターIPC、音声テストボタンの完了を確認 |
| 自動テスト | JavaScript 1,199件、Python 58件が成功 |

scripts/verify-speech-enhancement.cjsは導入済みモデルで合成・前処理・認識を試す。scripts/verify-speech-enhancement-ui.cjsは機密情報を除いた専用プロフィールで設定画面と実際のIPCを試す。後者に通常プロフィールを渡さない。今回の生の検証結果と画面はwork/evidence/speech-enhancement-0101に保存した。

音が聞きやすくなることと、認識精度が上がること、低遅延で会話できることはそれぞれ分けて評価する。

- https://github.com/nyosegawa/speech.cpp/releases/tag/v0.10.1
- https://github.com/nyosegawa/speech.cpp/blob/v0.10.1/docs/models/semamba.md
- https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE