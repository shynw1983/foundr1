const platformLabels = {
  uber_eats: "Uber",
  rocket_now: "火箭",
  demae_can: "出前馆"
};

export function readableVoiceError(value) {
  const error = String(value ?? "").trim();
  if (/credentials_missing/i.test(error)) return "尚未保存自动登录信息";
  if (/credentials_rejected/i.test(error)) return "自动登录信息不正确";
  if (/account_locked/i.test(error)) return "账号已被锁定，需要人工处理";
  if (/password_expired/i.test(error)) return "密码已过期，需要人工处理";
  if (/login required|demae_can_login|ログイン/i.test(error)) return "自动重新登录失败";
  if (/multiple target matches|複数の候補|多个候选/i.test(error)) return "找到多个同名商品";
  if (/target verification failed|対応する.*見つかりません/i.test(error)) return "找不到对应商品";
  if (/timed out|timeout/i.test(error)) return "平台页面响应超时";
  if (/expired/i.test(error)) return "任务已过期";
  return "修改失败";
}

export function formatVoiceFailure(value) {
  const error = String(value ?? "").replace(/^Foundr1 HTTP \d+:\s*/i, "").trim();
  if (/対応する商品または選択肢が見つかりません|找不到|not found/i.test(error)) {
    return "没有找到这个商品，请换一个商品名称再试。";
  }
  if (/複数の候補があります|多个候选|multiple/i.test(error)) {
    return "找到了多个相似商品，请说出更完整的商品名称。";
  }
  if (/credentials_missing/i.test(error)) {
    return "操作失败，尚未在 Mac 钥匙串中保存出前馆登录信息。";
  }
  if (/credentials_rejected|account_locked|password_expired/i.test(error)) {
    return "操作失败，出前馆账号需要人工处理，请查看 Store App 里的具体状态。";
  }
  if (/ログインしてください|login required|demae_can_login|未登录/i.test(error)) {
    return "操作失败，出前馆自动重新登录失败。";
  }
  if (/権限|permission|forbidden/i.test(error)) {
    return "操作失败，当前账号没有权限。";
  }
  return "操作失败，请查看 Store App 里的同步状态。";
}

export function formatVoiceResult({ matchedLabel, isAvailable, commands }) {
  const action = isAvailable ? "恢复销售" : "设为永久缺货";
  const results = ["网站预约成功", ...commands.map((command) => {
    const label = platformLabels[command.platform] ?? command.platform;
    return command.status === "succeeded"
      ? `${label}成功`
      : `${label}失败，${readableVoiceError(command.error)}`;
  })];
  return `${matchedLabel}已${action}。${results.join("，")}。`;
}

export function formatVoiceAcknowledgement({ query, isAvailable }) {
  const action = isAvailable ? "恢复销售" : "设为永久缺货";
  return `正在将${query}${action}，请稍候。完成后我会告诉你结果。`;
}

export function formatVoiceConfirmation({ query, isAvailable }) {
  const action = isAvailable ? "恢复销售" : "设为永久缺货";
  return `你说的是${query}，要${action}，对吗？请回答是或者不是。`;
}

export function classifyVoiceConfirmation(value) {
  const answer = String(value ?? "").trim();
  if (/^(不是|不对|错了|否|不要|重新|更改|换一个)[。.!！]?$/.test(answer)) return "no";
  if (/^(是|是的|对|对的|没错|确认|可以|好|好的|嗯|嗯嗯)[。.!！]?$/.test(answer)) return "yes";
  return "unknown";
}
