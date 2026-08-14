# Foundr1 Desktop Bridge

Mac 上の専用 Chrome を使い、Foundr1 OS の販売可否をデリバリー各社の
Web 管理画面へ同期するローカルワーカーです。注文受付タブレットの画面は操作しません。

## Safety model

- 初期状態では `executionEnabled` が `false` で、実商品を変更しません。
- プラットフォームごとに独立した Chrome プロファイルを使用します。
- 商品は完全一致する候補が一つだけの場合に限って操作します。
- 保存後の再読込で状態を確認できない場合は成功にしません。
- ログイン切れやページ構造変更時は停止し、推測した座標をクリックしません。

## Local setup

```bash
npm install
cp config.example.json config.local.json
npm run login
npm run check
```

商品名が各管理画面で一意に見つかるか、変更せず確認できます。

```bash
node src/main.mjs locate uber_eats '牛肉マーラータン'
```

一つのプラットフォームだけを開く場合：

```bash
node src/main.mjs login demae_can
```

`npm run login` は Uber Eats、Rocket Now、出前館の専用 Chrome を開きます。
各ウィンドウで一度ログインした後、ターミナルで `Ctrl-C` を押します。
Chrome 自体は閉じず、Bridge の検査・実行プロセスだけが接続と切断を行います。
通常運用では Uber Eats を同じログインプロファイルのバックグラウンド Chrome で動かせます。
ログインが必要なときだけ `headless` を一時的に `false` にして可視ウィンドウを開きます。

## Siri / macOS Shortcuts

音声操作は Bridge の端末トークンをそのまま利用し、ショートカット側には認証情報を保存しません。
実行前にショートカットで商品名を聞き、中国語で商品名と操作を復唱します。「是」の場合だけ
実行し、「不是」または不明瞭な回答の場合は商品名の聞き取りからやり直します。

```bash
/usr/local/bin/node src/voice-command.mjs stockout --preview --shortcut '商品名'
/usr/local/bin/node src/voice-command.mjs stockout --voice-confirm --shortcut '是または不是'
/usr/local/bin/node src/voice-command.mjs restore --preview --shortcut '商品名'
/usr/local/bin/node src/voice-command.mjs restore --voice-confirm --shortcut '是または不是'
```

`stockout` は各サービスで翌日に戻らない永久在庫切れを使用します。商品名が見つからない、
または複数候補になる場合は何も変更しません。ショートカットからの実行時は受付メッセージを
すぐ返し、プラットフォームの完了待ちはバックグラウンドで継続します。完了後は Siri の
セッションに依存せず、Mac の中国語音声 `Ting-Ting` で Web予約、Uber、Rocket Now、
出前館それぞれの結果を読み上げます。結果は `~/Library/Logs/Foundr1 Desktop Bridge/voice.log`
にも記録します。

常駐実行は商品変更の実機検証後にのみ有効化します。

## macOS auto start

実商品で「販売停止 → 販売再開」の往復確認が完了した後、
`config.local.json` の `executionEnabled` を `true` にしてインストールします。

```bash
npm run install:mac
```

これはユーザーの `LaunchAgent` として動くため、Apple Developer アカウントや
アプリ署名は不要です。ログは `~/Library/Logs/Foundr1 Desktop Bridge/` に保存されます。
