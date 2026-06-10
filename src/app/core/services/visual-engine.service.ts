import { Injectable, inject, signal } from '@angular/core';
import {
  ACESFilmicToneMapping,
  Clock,
  Color,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderer
} from 'three';

import {
  FrameCallback,
  FrameContext,
  ViewportSize
} from '../../shared/models/visual-engine.models';
import { AudioEngineService } from './audio-engine.service';

@Injectable({ providedIn: 'root' })
export class VisualEngineService {
  private readonly audioEngine = inject(AudioEngineService);

  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private readonly clock = new Clock(false);
  private readonly frameCallbacks = new Set<FrameCallback>();
  private animationFrameId = 0;
  private resizeObserver: ResizeObserver | null = null;

  readonly isInitialized = signal(false);
  readonly isRendering = signal(false);
  readonly viewportSize = signal<ViewportSize>({ width: 0, height: 0, pixelRatio: 1 });

  initialize(canvas: HTMLCanvasElement): void {
    if (this.renderer !== null) {
      return;
    }

    const renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    const scene = new Scene();
    scene.background = new Color(0x000000);

    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.observeHostResize(canvas);
    this.isInitialized.set(true);
  }

  startRenderLoop(): void {
    if (this.renderer === null || this.isRendering()) {
      return;
    }
    this.clock.start();
    this.isRendering.set(true);
    this.animationFrameId = requestAnimationFrame(this.renderFrame);
  }

  stopRenderLoop(): void {
    if (!this.isRendering()) {
      return;
    }
    cancelAnimationFrame(this.animationFrameId);
    this.clock.stop();
    this.isRendering.set(false);
  }

  registerFrameCallback(callback: FrameCallback): () => void {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  getScene(): Scene {
    if (this.scene === null) {
      throw new Error('VisualEngineService not initialized');
    }
    return this.scene;
  }

  getCamera(): PerspectiveCamera {
    if (this.camera === null) {
      throw new Error('VisualEngineService not initialized');
    }
    return this.camera;
  }

  getRenderer(): WebGLRenderer {
    if (this.renderer === null) {
      throw new Error('VisualEngineService not initialized');
    }
    return this.renderer;
  }

  getCanvas(): HTMLCanvasElement {
    return this.getRenderer().domElement;
  }

  dispose(): void {
    this.stopRenderLoop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.frameCallbacks.clear();
    this.scene?.clear();
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.isInitialized.set(false);
    this.viewportSize.set({ width: 0, height: 0, pixelRatio: 1 });
  }

  private readonly renderFrame = (): void => {
    if (this.renderer === null || this.scene === null || this.camera === null) {
      return;
    }

    const frame: FrameContext = {
      elapsedSeconds: this.clock.elapsedTime,
      deltaSeconds: this.clock.getDelta(),
      audioContextTime: this.audioEngine.getCurrentTime()
    };

    for (const callback of this.frameCallbacks) {
      callback(frame);
    }

    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.renderFrame);
  };

  private observeHostResize(canvas: HTMLCanvasElement): void {
    const host = canvas.parentElement;
    if (host === null) {
      return;
    }

    this.applySize(host.clientWidth, host.clientHeight);

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this.applySize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    this.resizeObserver.observe(host);
  }

  private applySize(width: number, height: number): void {
    if (this.renderer === null || this.camera === null || width === 0 || height === 0) {
      return;
    }
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.viewportSize.set({
      width,
      height,
      pixelRatio: this.renderer.getPixelRatio()
    });
  }
}
