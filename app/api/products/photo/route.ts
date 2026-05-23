import { put } from "@vercel/blob";
import { sql } from "../../../../lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const productName = String(formData.get("productName") ?? "");
  const file = formData.get("file");

  if (!productName) {
    return Response.json({ error: "productName is required" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json(
      { error: "Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。" },
      { status: 503 }
    );
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeName = productName.replace(/[^\w.-]+/g, "-").toLowerCase();
  const blob = await put(`products/${safeName}-${Date.now()}.${extension}`, file, {
    access: "public"
  });

  await sql`
    update products
    set
      photo_url = ${blob.url},
      updated_at = now()
    where name = ${productName}
  `;

  return Response.json({ url: blob.url });
}
