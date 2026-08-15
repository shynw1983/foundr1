import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyVoiceConfirmation,
  formatVoiceAcknowledgement,
  formatVoiceConfirmation,
  formatVoiceFailure,
  formatVoiceResult,
  readableVoiceError
} from "../src/voice-result.mjs";

test("formats successful permanent stockout feedback", () => {
  assert.equal(formatVoiceResult({
    matchedLabel: "南乳汁",
    isAvailable: false,
    commands: [
      { platform: "uber_eats", status: "succeeded", error: "" },
      { platform: "rocket_now", status: "succeeded", error: "" },
      { platform: "demae_can", status: "succeeded", error: "" }
    ]
  }), "南乳汁已设为永久缺货。网站预约成功，Uber成功，火箭成功，出前馆成功。");
});

test("translates login failures into spoken feedback", () => {
  assert.equal(readableVoiceError("demae_can: login required"), "自动重新登录失败");
  assert.equal(readableVoiceError("demae_can_credentials_missing"), "尚未保存自动登录信息");
  assert.equal(readableVoiceError("demae_can_login_account_locked"), "账号已被锁定，需要人工处理");
});

test("formats immediate restore acknowledgement for Siri", () => {
  assert.equal(formatVoiceAcknowledgement({
    query: "二八酱",
    isAvailable: true
  }), "正在将二八酱恢复销售，请稍候。完成后我会告诉你结果。");
});

test("asks for spoken confirmation in Chinese", () => {
  assert.equal(formatVoiceConfirmation({
    query: "香醋",
    isAvailable: false
  }), "你说的是香醋，要设为永久缺货，对吗？请回答是或者不是。");
});

test("translates Japanese API matching errors into Chinese", () => {
  assert.equal(
    formatVoiceFailure("Foundr1 HTTP 404: 「香酢」に対応する商品または選択肢が見つかりません。"),
    "没有找到这个商品，请换一个商品名称再试。"
  );
});

test("classifies Chinese spoken confirmation without treating 不是 as yes", () => {
  assert.equal(classifyVoiceConfirmation("是的"), "yes");
  assert.equal(classifyVoiceConfirmation("不是"), "no");
  assert.equal(classifyVoiceConfirmation("狮子"), "unknown");
});
