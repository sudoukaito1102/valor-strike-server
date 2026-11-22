# VALOR STRIKE オンライン対戦サーバー

VALOR STRIKE（Web版FPS）のオンライン対戦に使う、WebSocket の中継サーバーです。

- このサーバーは「中継」だけをします。ゲームの判定（当たり判定やHP計算）はゲーム側（各プレイヤーの端末）が行います。
- 同じ「合言葉（ルーム名）」で入ったプレイヤー同士の状態を転送し合います。
- 1ルーム最大10人まで。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `server.js` | サーバー本体（これを起動する） |
| `package.json` | 設定ファイル（依存は `ws` のみ） |
| `test.js` | 自動テスト（`npm test` で実行） |
| `README.md` | この説明書 |

## ローカルでの起動方法（自分のPCで試す場合）

1. Node.js（バージョン18以上）をインストールする
2. このフォルダで以下を実行する

```
npm install
node server.js
```

3. `valor-strike-server listening on port 8080` と出れば起動成功
4. ゲーム側の接続先は `ws://localhost:8080`（同じPC内だけ有効）

---

## 無料でインターネットに公開する手順

ゲーム側は `wss://`（暗号化つき）のURLで接続するので、下記のどちらかの無料サービスに置きます。どちらもクレジットカード不要です。

### 方法A：Render（おすすめ・ずっと置いておける）

1. Render のアカウントを作る
   - https://render.com を開く
   - 「Get Started for Free」→ GitHub かメールアドレスで登録する（無料）
2. このフォルダを GitHub に置く
   - GitHub のアカウントが無ければ https://github.com で作る（無料）
   - GitHub で「New repository」→ 名前は例：`valor-strike-server` → 「Create repository」
   - このフォルダの中身（`server.js`、`package.json`、`README.md`）をアップロードする
     （リポジトリ画面の「uploading an existing file」からドラッグ＆ドロップでOK。`node_modules` フォルダはアップロードしない）
3. Render でサービスを作る
   - Render のダッシュボードで「New +」→「Web Service」を選ぶ
   - さっきの GitHub リポジトリを選んで「Connect」
   - 設定はこうする：
     - Runtime： `Node`
     - Build Command： `npm install`
     - Start Command： `node server.js`
     - Instance Type： `Free`
   - 「Create Web Service」を押す
4. デプロイ完了を待つ（数分）
   - 画面上部に `https://valor-strike-server-xxxx.onrender.com` のようなURLが表示される
5. URL をゲーム用に変換する
   - 先頭の `https://` を `wss://` に変えるだけ
   - 例：`wss://valor-strike-server-xxxx.onrender.com`
6. ゲーム側の設定
   - VALOR STRIKE のロビー画面にある「サーバーURL」欄に、その `wss://` のURLを貼る
   - 遊ぶ全員が、同じサーバーURL＋同じ合言葉で入れば対戦できる

> Render の無料プランは、しばらく誰も使わないとサーバーが眠ります。次に接続したとき目覚めるまで30〜60秒ほどかかることがあります（最初の1回だけ遅いのはそのためです）。

### 方法B：Glitch（ブラウザだけで完結・登録が簡単）

1. Glitch のアカウントを作る
   - https://glitch.com を開く
   - 「Sign up」→ メールアドレスか GitHub で登録する（無料）
2. プロジェクトを作る
   - 「New Project」→「glitch-hello-node」などの Node テンプレートを選ぶ
3. ファイルを入れ替える
   - 左側のファイル一覧で `server.js` を開き、中身をこのフォルダの `server.js` の内容に全部置き換える
   - `package.json` も同様に、このフォルダの `package.json` の内容に置き換える
     （依存に `ws` が書いてあるので、自動でインストールされます）
   - 画面下の「Logs」にエラーが出ていないか確認する
4. URL を確認する
   - 上部の「Share」→「Live Site」のURLをコピーする
   - 例：`https://valor-strike-server.glitch.me`
5. URL をゲーム用に変換する
   - 先頭の `https://` を `wss://` に変える
   - 例：`wss://valor-strike-server.glitch.me`
6. ゲーム側の設定
   - VALOR STRIKE のロビー画面の「サーバーURL」欄に貼る
   - 遊ぶ全員が、同じサーバーURL＋同じ合言葉で入る

> Glitch の無料プランも、しばらく使わないとプロジェクトが眠ります。接続時に目覚めるまで少し待つことがあります。

---

## 動作確認のしかた

- ブラウザでサーバーの `https://` のURLを開くと、`{"ok":true,...}` と表示されれば稼働中です（ルーム数と接続数も出ます）
- コードを変えたら `npm test` で自動テストが全部 PASS するか確認できます

## 仕様メモ（開発者向け）

- プロトコルは JSON over WebSocket：`join`（入室）／`state`（状態中継）／`event`（射撃・ヒット等のイベント転送）
- 1ルーム最大10人、メッセージ上限16KB、30秒無通信で切断（ハートビート）
- ポートは環境変数 `PORT`（無ければ 8080）
