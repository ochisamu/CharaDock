# GitHub公開チェックリスト

## 公開前の必須確認

- [x] プロジェクトオリジナル4キャラクターの元絵と生成差分がOpenAI `gpt-image-2`で作成された来歴を、READMEと`DISTRIBUTION_ASSET_LICENSE.md`に記録した。
- [x] AIニケちゃんの収録許可とクレジットを、アプリ、README、配布物のライセンス文書に記録した。
- [ ] 生成時の入力に、許諾のない第三者画像・商標・実在人物の肖像が含まれていないことを最終確認する。
- [ ] `docs/images/charadock-work-mode.png`、`app-icon.ico`、`app-icon.png`を公開できる。
- [ ] `DISTRIBUTION_ASSET_LICENSE.md`の条件が権利者の意図と一致している。
- [ ] 上流PuruPuru PNGTuberの`LICENSE`、`NOTICE`、`MODIFICATIONS.md`、`THIRD_PARTY_NOTICES.md`を残している。
- [ ] READMEの「非公式派生アプリ」という表記を残している。

画像の権利確認が終わるまでは、GitHubリポジトリをPublicにしないでください。

## ローカル監査

```bash
npm ci
npm test
npm run site:build
npm audit
gitleaks git . --redact=100 --config .gitleaks.toml
uv lock --check
uv run python scripts/verify_vendor_checksums.py
git status --short --ignored
```

確認項目:

- [ ] `.env`、`.npmrc`、APIキー、秘密鍵、Codex認証情報がない。
- [ ] コミットのauthor / committerメールがGitHubのnoreplyアドレスになっている。
- [ ] `source/`、`work/`、`dist/`、`node_modules/`、`.venv/`が追跡対象外である。
- [ ] 100MB以上のGit対象ファイルがない。
- [ ] README内の相対リンクと画像が表示できる。
- [ ] Electronスモークテストが通る。

## 初回コミット

このリポジトリの既定ブランチは`main`です。公開先を作成した後、内容を再確認してから実行します。

```bash
git add .
git status --short
git commit -m "Initial public release preparation"
git remote add origin <repository-url>
git push -u origin main
```

この手順は認証情報や画像権利の確認を代替しません。`git add .`の後に必ず一覧を確認してください。

## GitHub側の推奨設定

- [ ] Actionsの既定権限をread-onlyにする。
- [ ] `main`へプルリクエストとCI成功を必須にする。
- [ ] Secret scanningとPush protectionを有効にする。
- [ ] Dependabot alertsとDependabot security updatesを有効にする。
- [ ] Private vulnerability reportingを有効にする。
- [ ] Issue templatesとSecurity policyが表示されることを確認する。
- [ ] **Settings → Pages → Source**を**GitHub Actions**にし、`GitHub Pages` workflowの公開URLを確認する。
- [ ] Actionsの`Windows package`を手動実行し、portable版、installer、`SHA256SUMS.txt`を取得できる。

## Windows配布時

`package.json`のversionを更新し、同じ番号のタグ（例: `v0.1.0`）をpushすると、ActionsがWindowsでportable版とNSIS installerを生成してDraft Releaseへ添付します。

```bash
git tag v0.1.0
git push origin v0.1.0
```

- [ ] クリーンなWindows 10/11 x64で初回起動を確認する。
- [ ] ChatGPTログイン、Chat、Work、音声フォールバックを確認する。
- [ ] ZIP/インストーラーへ旧デモアバターと旧faviconが混入していない。
- [ ] `LICENSE`、`NOTICE`、`MODIFICATIONS.md`、アセット条件、第三者通知を同梱する。
- [ ] あみたろの声素材工房の現行規約を再確認し、公開後おおむね1か月以内を目安にアプリへの音声同梱を連絡する。
- [ ] SHA-256を公開する。
- [ ] 一般配布前にコード署名を検討する。

## Git LFSについて

現時点ではGit対象の最大ファイルがGitHubの100MB上限未満なので、Git LFSは必須ではありません。画像やモデルを頻繁に更新して履歴が急増する場合だけ、移行手順と利用者への影響を決めてから導入してください。
