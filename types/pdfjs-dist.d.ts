declare module "pdfjs-dist/build/pdf.mjs" {
  export const GlobalWorkerOptions: {
    workerSrc: string;
  };

  export function getDocument(options: { data: Uint8Array }): {
    promise: Promise<{
      getPage(pageNumber: number): Promise<{
        getViewport(options: { scale: number }): { width: number; height: number };
        render(options: {
          canvasContext: CanvasRenderingContext2D;
          viewport: { width: number; height: number };
        }): { promise: Promise<void> };
      }>;
      destroy(): void;
    }>;
  };
}
