# コハク・表現拡張（試作）

現在のPC用拡張はユーザー提供の作画素材へ置換済み。
操作・制限・検証は [v9実装](kohaku-authored-motion-v9.md) を参照。
以下は旧手ポーズ実装の制作記録で、現在の拡張描画には使用しない。

標準コハク（amber-avatar）のPC表示向け。Jevと「表情の選択」を有効にし、
「コハク・表現拡張（試作）」をONにする。既定OFF。ニケの設定とは独立。
カスタムキャラ・RLCD画像・ファームは変更しない。Live2D/Cubismではなく、
生成差分と既存Canvasメッシュを用いた小さな可動範囲の試作。

- 考える・説明する・喜ぶ：生成した手と体の3ポーズ、各6枚（口3段階×開閉眼）。
- うなずく・驚いて引く・寄り添う：既存の有限モーションを使用。
- コハク専用の首・肩・手の座標。頭に前後の髪を追従させる。
- ゆっくり小さく変化する待機モーション、頭と肩の位相差、割込み時の位置・速度保持。
- 動きを減らすOS設定では追加モーションを減衰。口パク・瞬きは既存コントローラが所有。
- Jevには実装済みのneutral/happy/thinking/surprised/softだけ提示。
  ニケ専用joy/proud/worried/exasperatedはコハクで選択しない。
- APIをフレームごとに呼ばない。既存の入力・応答分類を利用する。
  Liveの文字到着による遅れがなくなる保証はない。

## 素材と再現

組み込みimagegenで登録済みの髪なし体レイヤーから手・体のみを生成。
原画：assets/kohaku-performance-sources/{ponder,explain,celebrate}.png。
原画は配布パッケージには含めない。プロンプトは同ディレクトリのprompts.md。
頭・目・口は既存素材で固定し、顔を再生成した絵へ丸ごと置き換えない。
コハクは前後の髪が独立しているため、生成体にも髪を描かない。

```bash
node scripts/build-kohaku-performances.cjs assets/kohaku-performance-sources
node --test desktop/tests/kohaku-performance.test.cjs desktop/tests/nike-performance.test.cjs
```

このアセンブラは1254角のコハク用。任意キャラへの座標流用は禁止。
新キャラでは専用座標・素材登録と口/目/手/髪の視覚確認が必要。
ニケ版の素材と挙動は保持する。会話の性能・API速度の保証とは別。

## 今回の検証

- デスクトップ990テスト成功、JS runtimeチェック成功。
- 実Jev APIへ公開用の例文3件を送信し、thinking/ponder、neutral/explain、happy/celebrateを確認。
- 専用の一時プロファイルでWindows Electronの実Canvasを15秒録画。
  描画更新878回（約58fps）、レンダラーエラーなし。通常プロファイルは不変更。
- 録画は人工的な仕草指示と音声レベルによる無音動作テスト。
  実会話・実音声の同期検証ではない。公開デモでは実会話を別途収録すること。
- 紹介画像は説明イラストであり、実際のアプリ画面として扱わない。
