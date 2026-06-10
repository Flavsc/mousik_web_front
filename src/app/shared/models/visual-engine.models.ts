export interface FrameContext {
  readonly elapsedSeconds: number;
  readonly deltaSeconds: number;
  readonly audioContextTime: number;
}

export type FrameCallback = (frame: FrameContext) => void;

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export interface VideoExportConfig {
  readonly frameRate: number;
  readonly mimeType: string;
  readonly videoBitsPerSecond: number;
  readonly audioBitsPerSecond: number;
}

export const DEFAULT_VIDEO_EXPORT_CONFIG: VideoExportConfig = {
  frameRate: 60,
  mimeType: 'video/webm;codecs=vp9,opus',
  videoBitsPerSecond: 12_000_000,
  audioBitsPerSecond: 256_000
};
