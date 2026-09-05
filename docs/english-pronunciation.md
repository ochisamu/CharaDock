# 英単語の日本語読み

PCの共通TTS前処理 `desktop/lib/speech-pronunciation.cjs` で変換する。
ユーザー辞書 → 製品名・慣用読み → CamelCase/ハイフン分割 →
大文字略語の字読み → 既存CMU発音辞書、の順で扱う。
未知語やパス・URL・ファイル名・バージョンは無理に推定しない。
ユーザー辞書の出力を再変換せず、回答履歴自体も変更しない。

参照会話で挙がった zunan-islands/Style-Bert-VITS2 の
`katakana_map.py` / `normalizer.py`（commit
`6b0ec1352fd09b5295568fc98db4e851d3c17249`）は調査対象のみ。
リポジトリのLICENSEはAGPL-3.0、辞書個別の由来・再配布条件は未確認のため、
そのコード・辞書のコピーや翻訳移植は行っていない。
e2kのモデルも新しく取得しない。本変更は既存辞書を用いた独自の境界処理であり、
AivisSpeechと同一の読みを保証するものではない。

参照: https://github.com/zunan-islands/Style-Bert-VITS2/tree/6b0ec1352fd09b5295568fc98db4e851d3c17249

検証: `node --test desktop/tests/speech-pronunciation.test.cjs`
