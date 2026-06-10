import { Color, IcosahedronGeometry, Mesh, MeshStandardMaterial } from 'three';

import { AudioAnalysisFrame } from '../../shared/models/audio-engine.models';
import { clamp } from '../audio/music-math';
import { SIMPLEX_NOISE_GLSL } from './simplex-noise.glsl';

const SMOOTHING_RATE = 9;
const BASS_SCALE_GAIN = 0.45;
const MID_ROUGHNESS_RANGE = 0.75;
const MID_EMISSIVE_GAIN = 2.5;

export class AudioReactiveCore {
  readonly mesh: Mesh;

  private readonly geometry: IcosahedronGeometry;
  private readonly material: MeshStandardMaterial;
  private readonly timeUniform = { value: 0 };
  private readonly bassUniform = { value: 0 };
  private smoothedBass = 0;
  private smoothedMid = 0;

  constructor() {
    this.geometry = new IcosahedronGeometry(1.6, 48);
    this.material = new MeshStandardMaterial({
      color: new Color(0xdedede),
      metalness: 0.4,
      roughness: 0.9,
      emissive: new Color(0xff0000),
      emissiveIntensity: 0
    });

    this.material.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = this.timeUniform;
      shader.uniforms['uBassEnergy'] = this.bassUniform;
      shader.vertexShader = `
uniform float uTime;
uniform float uBassEnergy;
${SIMPLEX_NOISE_GLSL}
${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec3 noiseCoordinate = position * 1.4 + vec3(0.0, uTime * 0.4, 0.0);
float surfaceDisplacement = snoise(noiseCoordinate);
transformed += normal * surfaceDisplacement * uBassEnergy * 0.9;`
      );
    };
    this.material.customProgramCacheKey = () => 'mousik-audio-reactive-core';

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  update(frame: AudioAnalysisFrame, elapsedSeconds: number, deltaSeconds: number): void {
    const smoothing = Math.min(1, deltaSeconds * SMOOTHING_RATE);
    this.smoothedBass += (frame.bassEnergy - this.smoothedBass) * smoothing;
    this.smoothedMid += (frame.midEnergy - this.smoothedMid) * smoothing;

    this.timeUniform.value = elapsedSeconds;
    this.bassUniform.value = this.smoothedBass;

    this.mesh.scale.setScalar(1 + this.smoothedBass * BASS_SCALE_GAIN);
    this.material.roughness = clamp(0.9 - this.smoothedMid * MID_ROUGHNESS_RANGE, 0.05, 1);
    this.material.emissiveIntensity = this.smoothedMid * MID_EMISSIVE_GAIN;

    this.mesh.rotation.y += deltaSeconds * (0.12 + this.smoothedMid * 0.8);
    this.mesh.rotation.x += deltaSeconds * 0.05;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
