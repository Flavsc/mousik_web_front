import { Injectable, inject, signal } from '@angular/core';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Clock,
  Color,
  PerspectiveCamera,
  PointLight,
  SRGBColorSpace,
  Scene,
  WebGLRenderer
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import {
  FrameCallback,
  FrameContext,
  ViewportSize
} from '../../shared/models/visual-engine.models';
import { AudioReactiveCore } from '../visual/audio-reactive-core';
import { CRT_SHADER } from '../visual/crt-shader';
import { REACTIVE_NOISE_SHADER } from '../visual/reactive-noise-shader';
import { TrebleParticleField } from '../visual/treble-particle-field';
import { AudioEngineService } from './audio-engine.service';

const RMS_SMOOTHING_RATE = 8;
const BASE_RGB_SHIFT = 0.0012;
const RMS_RGB_SHIFT_GAIN = 0.004;

@Injectable({ providedIn: 'root' })
export class VisualEngineService {
  private readonly audioEngine = inject(AudioEngineService);

  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private outputPass: OutputPass | null = null;
  private noisePass: ShaderPass | null = null;
  private crtPass: ShaderPass | null = null;
  private reactiveCore: AudioReactiveCore | null = null;
  private particleField: TrebleParticleField | null = null;
  private readonly clock = new Clock(false);
  private readonly frameCallbacks = new Set<FrameCallback>();
  private animationFrameId = 0;
  private resizeObserver: ResizeObserver | null = null;
  private smoothedRms = 0;

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

    const ambientLight = new AmbientLight(0xffffff, 0.3);
    const keyLight = new PointLight(0xffffff, 90);
    keyLight.position.set(6, 7, 8);
    const redLight = new PointLight(0xff0000, 60);
    redLight.position.set(-8, -4, 6);
    const blueLight = new PointLight(0x0000ff, 60);
    blueLight.position.set(8, -3, -6);
    scene.add(ambientLight, keyLight, redLight, blueLight);

    const reactiveCore = new AudioReactiveCore();
    scene.add(reactiveCore.mesh);

    const particleField = new TrebleParticleField();
    scene.add(particleField.mesh);

    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    const renderPass = new RenderPass(scene, camera);
    const outputPass = new OutputPass();
    const noisePass = new ShaderPass(REACTIVE_NOISE_SHADER);
    const crtPass = new ShaderPass(CRT_SHADER);
    composer.addPass(renderPass);
    composer.addPass(outputPass);
    composer.addPass(noisePass);
    composer.addPass(crtPass);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = composer;
    this.renderPass = renderPass;
    this.outputPass = outputPass;
    this.noisePass = noisePass;
    this.crtPass = crtPass;
    this.reactiveCore = reactiveCore;
    this.particleField = particleField;

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
    this.reactiveCore?.dispose();
    this.particleField?.dispose();
    this.renderPass?.dispose();
    this.outputPass?.dispose();
    this.noisePass?.dispose();
    this.crtPass?.dispose();
    this.composer?.dispose();
    this.scene?.clear();
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.composer = null;
    this.renderPass = null;
    this.outputPass = null;
    this.noisePass = null;
    this.crtPass = null;
    this.reactiveCore = null;
    this.particleField = null;
    this.smoothedRms = 0;
    this.isInitialized.set(false);
    this.viewportSize.set({ width: 0, height: 0, pixelRatio: 1 });
  }

  private readonly renderFrame = (): void => {
    if (this.composer === null || this.scene === null || this.camera === null) {
      return;
    }

    const deltaSeconds = this.clock.getDelta();
    const elapsedSeconds = this.clock.elapsedTime;
    const analysis = this.audioEngine.captureAnalysisFrame();

    const smoothing = Math.min(1, deltaSeconds * RMS_SMOOTHING_RATE);
    this.smoothedRms += (analysis.rms - this.smoothedRms) * smoothing;

    const frame: FrameContext = {
      elapsedSeconds,
      deltaSeconds,
      audioContextTime: this.audioEngine.getCurrentTime()
    };
    for (const callback of this.frameCallbacks) {
      callback(frame);
    }

    this.reactiveCore?.update(analysis, elapsedSeconds, deltaSeconds);
    this.particleField?.update(analysis, deltaSeconds);

    if (this.noisePass !== null) {
      this.noisePass.uniforms['uTime'].value = elapsedSeconds;
      this.noisePass.uniforms['uRms'].value = this.smoothedRms;
    }
    if (this.crtPass !== null) {
      this.crtPass.uniforms['uTime'].value = elapsedSeconds;
      this.crtPass.uniforms['uRgbShift'].value =
        BASE_RGB_SHIFT + this.smoothedRms * RMS_RGB_SHIFT_GAIN;
    }

    this.composer.render(deltaSeconds);
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
    this.composer?.setSize(width, height);
    const pixelRatio = this.renderer.getPixelRatio();
    if (this.crtPass !== null) {
      this.crtPass.uniforms['uResolution'].value.set(width * pixelRatio, height * pixelRatio);
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.viewportSize.set({ width, height, pixelRatio });
  }
}
