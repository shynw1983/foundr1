import { put } from "@vercel/blob";
import { sql } from "../../../../lib/db";

const maxPhotoSizeBytes = 4 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const productName = String(formData.get("productName") ?? "new-product").trim();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "file is required" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return Response.json({ error: "画像ファイルを選択してください。" }, { status: 400 });
    }

    if (file.size > maxPhotoSizeBytes) {
      return Response.json({ error: "写真は4MB以下にしてください。" }, { status: 413 });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return Response.json(
        { error: "Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。" },
        { status: 503 }
      );
    }

    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const safeName = productName.replace(/[^\w.-]+/g, "-").toLowerCase() || "product";
    const blob = await put(`products/${safeName}-${Date.now()}.${extension}`, file, {
      access: "private"
    });
    const photoUrl = `/api/products/photo/view?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;

    if (productName && productName !== "new-product") {
      await sql`
        update products
        set
          photo_url = ${photoUrl},
          updated_at = now()
        where name = ${productName}
      `;
    }

    return Response.json({ url: photoUrl, pathname: blob.pathname });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "";

    if (message.toLowerCase().includes("body") || message.toLowerCase().includes("size")) {
      return Response.json(
        { error: "写真ファイルが大きすぎます。4MB以下に圧縮してからアップロードしてください。" },
        { status: 413 }
      );
    }

    if (message.toLowerCase().includes("blob") || message.toLowerCase().includes("token")) {
      return Response.json(
        { error: "Vercel Blob の保存に失敗しました。Blob の接続設定を確認してください。" },
        { status: 502 }
      );
    }

    return Response.json(
      { error: "写真をアップロードできませんでした。時間をおいて再試行してください。" },
      { status: 500 }
    );
  }
}
