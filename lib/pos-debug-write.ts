export function rejectDebugWrite(request: Request) {
  const url = new URL(request.url);
  let fromDebugPage = false;
  try {
    const referer = new URL(request.headers.get("referer") || "");
    fromDebugPage = referer.origin === url.origin && referer.pathname.replace(/\/+$/, "") === "/store/pos/debug";
  } catch { /* Requests without a referrer retain their ordinary behavior. */ }
  return url.searchParams.get("debug") === "1" || request.headers.get("x-foundr1-pos-debug") === "1" || fromDebugPage
    ? Response.json({ error: "テストモードでは正式な会計を保存できません。", code: "POS_DEBUG_WRITE_BLOCKED" }, { status: 409 })
    : null;
}
