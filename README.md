# Foundr1 Procurement Backoffice

店舗・ブランド横断の発注依頼、発注先、商品マスタ、権限スコープを管理する Next.js バックオフィスのプロトタイプです。

## Development

```bash
npm install
npm run dev
```

Local URL: `http://localhost:3000`

## Lark notifications

発注依頼を送信すると、アプリ内通知に加えて Lark にも通知できます。

- `LARK_APP_ID` / `LARK_APP_SECRET`: Lark 自建アプリの認証情報。スタッフに `lark_open_id` または `lark_user_id` が設定されている場合、本人へ私信します。
- `LARK_WEBHOOK_URL`: 任意。本人の Lark ID が未設定のとき、購入通知用グループ Bot に送る予備 webhook です。
- `NEXT_PUBLIC_APP_URL`: 任意。Lark のリンクを本番 URL にするためのアプリ URL です。
- `LARK_ENABLED=false`: 任意。Lark 送信だけを停止します。アプリ内通知はそのまま残ります。
