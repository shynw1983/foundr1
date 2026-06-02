import { requireOsSession } from "../../../../lib/api-auth";

export const dynamic = "force-dynamic";

type SalesAnalysisRequest = {
  storeName?: string;
  period?: {
    startDate?: string;
    endDate?: string;
  };
  facts?: unknown;
};

function trimFacts(value: unknown) {
  const text = JSON.stringify(value ?? {});
  return text.length > 16_000 ? text.slice(0, 16_000) : text;
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY が設定されていません。" }, { status: 400 });
  }

  const body = await request.json().catch(() => null) as SalesAnalysisRequest | null;
  if (!body?.facts) return Response.json({ error: "分析データがありません。" }, { status: 400 });

  const model = process.env.OPENAI_SALES_ANALYSIS_MODEL || "gpt-4.1-mini";
  const factsText = trimFacts(body.facts);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "あなたは飲食店バックオフィスの売上分析担当です。",
                "与えられた集計済みデータだけを根拠に、日本語で簡潔に分析してください。",
                "推測は『可能性』として表現し、データにない祝日・イベント・天気情報は断定しないでください。",
                "出力は見出し付きの短い箇条書きにしてください。",
                "必ず、売上構成、忙しさ、外卖/デリバリー手数料影響、勤怠未覆盖の注意点、次に確認することを含めてください。"
              ].join("\n")
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `店舗: ${body.storeName ?? ""}`,
                `期間: ${body.period?.startDate ?? ""} - ${body.period?.endDate ?? ""}`,
                "集計データ(JSON):",
                factsText
              ].join("\n")
            }
          ]
        }
      ],
      max_output_tokens: 900
    })
  });

  const responseBody = await response.json().catch(() => ({})) as {
    error?: { message?: string };
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  };

  if (!response.ok) {
    return Response.json({ error: responseBody.error?.message ?? "AI分析を作成できませんでした。" }, { status: response.status });
  }

  const text = responseBody.output_text
    ?? responseBody.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("\n").trim()
    ?? "";

  return Response.json({ analysis: text, model });
}
