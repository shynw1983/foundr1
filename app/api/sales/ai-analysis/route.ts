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
                "あなたは福岡の飲食店バックオフィス向けの経営分析担当です。",
                "これは一般的な月報ではなく、次月の営業判断・人員配置・データ確認に使う経営レビューです。",
                "与えられた集計済みデータだけを根拠に、日本語で具体的に分析してください。",
                "推測は『可能性』として表現し、データにない祝日・イベント・天気情報は断定しないでください。",
                "externalFactors がある場合は、流入・流出・混合という事前の人流方向と、同曜日・同時間帯基準に対する実績増減を分けて説明してください。相関だけで因果関係を断定しないでください。",
                "外部要因は必ず impactWindow の時間帯単位で扱い、終日売上だけから影響を判断しないでください。",
                "必ず数字を引用し、どの日・曜日・時間帯が根拠なのかを明記してください。",
                "デリバリー手数料は市場要因で操作できない前提です。改善提案ではなく、売上高と推定入金額の見え方の違いとして扱ってください。",
                "抽象的な助言は禁止です。『キャンペーンを検討』『天気を確認』のような一般論だけで終わらせないでください。",
                "出力は次の見出しで、短い箇条書きにしてください。",
                "1. 重要判断",
                "2. 売上と入金の見方",
                "3. 忙しさと人員配置",
                "4. 曜日・時間帯の使い方",
                "5. データ確認リスト",
                "6. 次月に試す具体策",
                "次月に試す具体策は、店が実行できる行動だけにしてください。例: シフト開始時刻の調整、ピーク前仕込み、特定曜日の人員確認、データ取込・勤怠修正。"
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
