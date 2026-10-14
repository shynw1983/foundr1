# 叫号屏缓存广播女声

`/store/display/pickup` 使用用户选定的 Erinome（G）设置生成的录音语音包。全部 39 个片段从一次生成的完整母带切分，包含 A–Z、0–9、号码前缀、完成提示及开启提示，不混合其他批次音频。

固定文本和号码规则在 `lib/pickup-voice.ts`。号码逐位读，保留前导零；不支持的字符不会被静默丢弃。母带、切分边界、生成设置保存在 `assets/pickup-voice/erinome`。新生成母带未必能完全复现原 G 试听音色，后续更换必须试听完整拼接结果。

## 播放行为

浏览器加载本站的 `public/audio/pickup/manifest.json` 和带 hash 的 WAV，解码后在内存中排队播放，并尝试通过 Cache Storage 保存完整包。每次启动刷新 manifest；已下载的 hash 音频可复用。断网可读取已完整缓存的语音包，但不能保证浏览器不会清理存储，也不能让未收到的新订单在离线时到达屏幕。

首次加载不重播已有 ready 订单。连续叫号不会互相截断；关闭声音、切换门店、离开页面时停止当前音频和队列。试听排在实际叫号之后。语音包缺失或损坏时明确显示端末 TTS 回退；播放被浏览器阻止时提示点击音声テスト。普通浏览器仍需要显式声音激活，Android TV 遥控器、扬声器与原生 WebView 行为需现场验证。未修改 Android APK。

播放不调用 Google/OpenAI 等合成服务，不上传订单或顾客信息，不发生每次叫号的合成费用。静态文件下载仍遵循托管服务的计费规则。仅改变叫号屏客户端播放，未修改订单 API、订单状态或品牌网站。

## 同一母带重新打包

```bash
node scripts/split-pickup-voice-master.mjs assets/pickup-voice/erinome/master.wav assets/pickup-voice/erinome/cues.json /private/tmp/pickup-erinome-segments
node scripts/import-pickup-voice-studio.mjs /private/tmp/pickup-erinome-segments
```

切分器拒绝母带指纹不符、缺失、越界和重叠的片段。导入器校验每片段指纹，防止混入其他生成批次；新音频和试听完成后才原子替换 manifest。来源条款及生成说明见 `public/audio/pickup/CREDITS.md`。

当前包版本 `6ee475cd03ae36c6`；母带指纹 `e3f1319fad833a33a4804c2912b99acdefb4547615b5d6230daef49dbd1caa2b`；音频约 1.1 MB，39 片段总长 22.193792 秒，峰值 28934，无满量程削波。

## 验证

```bash
node --experimental-strip-types --test lib/pickup-voice.test.ts scripts/tests/pickup-voice-client.test.cjs scripts/tests/pickup-voice-generation.test.mjs scripts/tests/pickup-voice-master.test.mjs
npm run build
git diff --check
```

验证覆盖逐位号码、排队、取消、缓存、首次点击激活时序、缺失/损坏回退、母带 SHA256 和边界、混入改动片段的拒绝及真实 WAV 范围。自动识别可确认 P-1204、Z-9876 拼接号码；自动转写不替代人耳验收。本地实际 pickup 页面已加载真实语音包、显示录音准备完了，试听无阻止提示及控制台错误。电视现场和真实订单叫号仍需营业环境验证。
