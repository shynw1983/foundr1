function normalizeText(value: unknown, maxLength = 1200) {
  return String(value ?? "").replace(/[\t\r]+/g, " ").trim().slice(0, maxLength);
}

type OpenAiTextResponse = {
  error?: { message?: string };
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
};

export async function translateOrderNoteToChinese(note: unknown) {
  const sourceText = normalizeText(note);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!sourceText || !apiKey) return "";

  const model = process.env.OPENAI_ORDER_NOTE_TRANSLATION_MODEL
    || process.env.OPENAI_MENU_TRANSLATION_MODEL
    || "gpt-5.6-luna";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "Translate a restaurant delivery customer's Japanese note into concise Simplified Chinese for kitchen staff.",
                "Preserve allergy, omission, spice, timing, and safety instructions exactly.",
                "The input contains only the customer's cooking request; do not add cutlery information.",
                "Return only the translated Chinese text, with no label, explanation, quotation marks, or markdown."
              ].join("\n")
            }]
          },
          {
            role: "user",
            content: [{ type: "input_text", text: sourceText }]
          }
        ],
        max_output_tokens: 240
      }),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({})) as OpenAiTextResponse;
    if (!response.ok) throw new Error(body.error?.message || "OpenAI order-note translation failed.");
    return normalizeText(
      body.output_text
        ?? body.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n")
        ?? ""
    );
  } catch (error) {
    console.error("[order-note-translation] translation failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return "";
  } finally {
    clearTimeout(timeout);
  }
}
