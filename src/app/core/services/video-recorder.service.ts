import { Injectable, inject, signal } from '@angular/core';

import {
  DEFAULT_VIDEO_EXPORT_CONFIG,
  VideoExportConfig
} from '../../shared/models/visual-engine.models';
import { AudioEngineService } from './audio-engine.service';
import { VisualEngineService } from './visual-engine.service';

const TIMESLICE_MS = 1000;
const URL_REVOKE_DELAY_MS = 10000;

const MIME_TYPE_FALLBACKS = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4'
];

@Injectable({ providedIn: 'root' })
export class VideoRecorderService {
  private readonly audioEngine = inject(AudioEngineService);
  private readonly visualEngine = inject(VisualEngineService);

  readonly isRecording = signal(false);
  readonly recordingSeconds = signal(0);
  readonly activeMimeType = signal('');

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private videoTrack: MediaStreamTrack | null = null;
  private audioTrack: MediaStreamTrack | null = null;
  private startContextTime = 0;
  private detachFrameCallback: (() => void) | null = null;
  private discardOnStop = false;

  async start(config: VideoExportConfig = DEFAULT_VIDEO_EXPORT_CONFIG): Promise<void> {
    if (this.isRecording() || !this.visualEngine.isInitialized()) {
      return;
    }
    this.audioEngine.initialize();
    await this.audioEngine.resume();

    const canvas = this.visualEngine.getCanvas();
    const videoStream = canvas.captureStream(config.frameRate);
    const videoTrack = videoStream.getVideoTracks()[0];
    const sourceAudioTrack = this.audioEngine.getRecordingStream().getAudioTracks()[0];
    if (videoTrack === undefined || sourceAudioTrack === undefined) {
      return;
    }
    const audioTrack = sourceAudioTrack.clone();
    const combinedStream = new MediaStream([videoTrack, audioTrack]);

    const mimeType = this.resolveSupportedMimeType(config.mimeType);
    const options: MediaRecorderOptions = {
      videoBitsPerSecond: config.videoBitsPerSecond,
      audioBitsPerSecond: config.audioBitsPerSecond
    };
    if (mimeType !== '') {
      options.mimeType = mimeType;
    }

    const recorder = new MediaRecorder(combinedStream, options);
    this.chunks = [];
    this.discardOnStop = false;
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    recorder.onstop = () => this.finalizeRecording();
    recorder.start(TIMESLICE_MS);

    this.recorder = recorder;
    this.videoTrack = videoTrack;
    this.audioTrack = audioTrack;
    this.startContextTime = this.audioEngine.getCurrentTime();
    this.recordingSeconds.set(0);
    this.activeMimeType.set(recorder.mimeType);
    this.detachFrameCallback = this.visualEngine.registerFrameCallback((frame) => {
      this.recordingSeconds.set(Math.max(0, frame.audioContextTime - this.startContextTime));
    });
    this.isRecording.set(true);
  }

  stop(): void {
    if (this.recorder === null) {
      return;
    }
    if (this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
  }

  cancel(): void {
    if (this.recorder === null) {
      return;
    }
    this.discardOnStop = true;
    if (this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
  }

  private finalizeRecording(): void {
    const mimeType = this.recorder?.mimeType ?? this.activeMimeType();
    const recordedChunks = this.chunks;
    const shouldDiscard = this.discardOnStop;

    this.chunks = [];
    this.discardOnStop = false;
    this.videoTrack?.stop();
    this.audioTrack?.stop();
    this.videoTrack = null;
    this.audioTrack = null;
    this.recorder = null;
    this.detachFrameCallback?.();
    this.detachFrameCallback = null;
    this.isRecording.set(false);

    if (shouldDiscard || recordedChunks.length === 0) {
      return;
    }
    this.downloadBlob(new Blob(recordedChunks, { type: mimeType }), mimeType);
  }

  private downloadBlob(blob: Blob, mimeType: string): void {
    if (blob.size === 0) {
      return;
    }
    const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `mousik-${timestamp}.${extension}`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), URL_REVOKE_DELAY_MS);
  }

  private resolveSupportedMimeType(preferred: string): string {
    for (const candidate of [preferred, ...MIME_TYPE_FALLBACKS]) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    }
    return '';
  }
}
