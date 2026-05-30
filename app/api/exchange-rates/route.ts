import { requireOsSession } from "../../../lib/api-auth";

const supportedPairs = new Set(["CNY-JPY"]);

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) {
    return Response.json({ error: "ログインしてください。" }, { status: 401 });
  }

  const url = new URL(request.url);
  const base = (url.searchParams.get("base") || "CNY").toUpperCase();
  const target = (url.searchParams.get("target") || "JPY").toUpperCase();

  if (!supportedPairs.has(`${base}-${target}`)) {
    return Response.json({ error: "対応していない通貨ペアです。" }, { status: 400 });
  }

  const response = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${target}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    return Response.json({ error: "為替レートを取得できませんでした。" }, { status: 502 });
  }

  const data = await response.json() as { date?: string; rates?: Record<string, number> };
  const rate = data.rates?.[target];
  if (!Number.isFinite(rate) || !rate) {
    return Response.json({ error: "為替レートを取得できませんでした。" }, { status: 502 });
  }

  return Response.json({
    base,
    target,
    rate,
    date: data.date ?? ""
  });
}
