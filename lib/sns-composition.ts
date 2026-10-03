export const SNS_WIDTH = 1080;
export const SNS_HEIGHT = 1920;
export const snsPresets = [
    { id: "A", label: "A · 原版ロゴ", x: 345, y: 1658, width: 390, height: 130 },
    { id: "B", label: "B · 小版ロゴ", x: 403, y: 1651, width: 274, height: 91 }
] as const;
export type SnsCrop = {
    zoom: number;
    x: number;
    y: number;
};
export function cropGeometry(width: number, height: number, crop: SnsCrop) {
    const scale = Math.max(SNS_WIDTH / width, SNS_HEIGHT / height) * Math.max(1, Math.min(4, crop.zoom));
    const w = width * scale, h = height * scale;
    const x = Math.max(SNS_WIDTH - w, Math.min(0, (SNS_WIDTH - w) / 2 + crop.x));
    const y = Math.max(SNS_HEIGHT - h, Math.min(0, (SNS_HEIGHT - h) / 2 + crop.y));
    return { x, y, width: w, height: h };
}
export function drawSns(canvas: HTMLCanvasElement, photo: CanvasImageSource | null, size: {
    width: number;
    height: number;
}, logo: CanvasImageSource, preset: typeof snsPresets[number], crop: SnsCrop) {
    canvas.width = SNS_WIDTH;
    canvas.height = SNS_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx)
        throw new Error("Canvas unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, SNS_WIDTH, SNS_HEIGHT);
    if (photo) {
        const g = cropGeometry(size.width, size.height, crop);
        ctx.drawImage(photo, g.x, g.y, g.width, g.height);
    }
    ctx.drawImage(logo, preset.x, preset.y, preset.width, preset.height);
}
