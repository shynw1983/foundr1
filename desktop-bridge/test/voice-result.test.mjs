import test from "node:test";
import assert from "node:assert/strict";
import { formatVoiceResult, readableVoiceError } from "../src/voice-result.mjs";

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
  assert.equal(readableVoiceError("demae_can: login required"), "需要重新登录");
});
