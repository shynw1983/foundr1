export type StoreCamera = { id: string; name: string; model: string };
export type CameraTicket = {
  v: 1; requestId: string; storeId: string; cameraId: string; bridgeDeviceId: string;
  actorId: string; sessionId: string; issuedAt: number; expiresAt: number;
};
export const cameraMaxBytes = 3_500_000;
export const cameraCaptureDeadlineMs = 90_000;
export const cameraTicketLifetimeMs = 5 * 60_000;
export const cameraRoles = new Set(["owner", "manager", "store_terminal"]);
export const cameraUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const cameraErrors: Record<string, string> = {
  unavailable: "カメラに接続できません。店舗のMacとカメラの接続を確認してください。",
  busy: "ほかの端末で映像を取得中です。少し待ってからお試しください。",
  login_required: "カメラの再ログインが必要です。管理者に連絡してください。",
  timeout: "映像の取得が時間内に完了しませんでした。店舗のMacとカメラの接続を確認してください。",
  too_large: "映像のサイズが上限を超えました。管理者に連絡してください。",
  cancelled: "映像の取得を終了しました。",
  playback: "この端末で映像を再生できません。別のブラウザでお試しください。",
  expired: "映像の有効期限が切れました。もう一度取得してください。",
};
