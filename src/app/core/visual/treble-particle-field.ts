import {
  BoxGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D
} from 'three';

import { AudioAnalysisFrame } from '../../shared/models/audio-engine.models';

const PARTICLE_COUNT = 512;
const FIELD_RADIUS = 8;
const BASE_SPEED = 0.25;
const TREBLE_SPEED_GAIN = 7;
const PEAK_SWIRL_GAIN = 2.5;
const PEAK_NORMALIZATION_HZ = 12000;
const SMOOTHING_RATE = 10;

export class TrebleParticleField {
  readonly mesh: InstancedMesh;

  private readonly geometry: BoxGeometry;
  private readonly material: MeshBasicMaterial;
  private readonly positions = new Float32Array(PARTICLE_COUNT * 3);
  private readonly velocities = new Float32Array(PARTICLE_COUNT * 3);
  private readonly proxy = new Object3D();
  private smoothedTreble = 0;

  constructor() {
    this.geometry = new BoxGeometry(0.07, 0.07, 0.07);
    this.material = new MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new InstancedMesh(this.geometry, this.material, PARTICLE_COUNT);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      this.resetParticle(index, true);
    }
  }

  update(frame: AudioAnalysisFrame, deltaSeconds: number): void {
    const smoothing = Math.min(1, deltaSeconds * SMOOTHING_RATE);
    this.smoothedTreble += (frame.trebleEnergy - this.smoothedTreble) * smoothing;

    const normalizedPeak = Math.min(1, frame.peakFrequencyHz / PEAK_NORMALIZATION_HZ);
    const speed = BASE_SPEED + this.smoothedTreble * TREBLE_SPEED_GAIN + normalizedPeak * 1.5;
    const swirlAngle = normalizedPeak * PEAK_SWIRL_GAIN * deltaSeconds;
    const swirlSin = Math.sin(swirlAngle);
    const swirlCos = Math.cos(swirlAngle);
    const particleScale = 0.3 + this.smoothedTreble * 2.2;

    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const offset = index * 3;
      let x = this.positions[offset] + this.velocities[offset] * speed * deltaSeconds;
      let y = this.positions[offset + 1] + this.velocities[offset + 1] * speed * deltaSeconds;
      let z = this.positions[offset + 2] + this.velocities[offset + 2] * speed * deltaSeconds;

      const swirledX = x * swirlCos - z * swirlSin;
      const swirledZ = x * swirlSin + z * swirlCos;
      x = swirledX;
      z = swirledZ;

      if (x * x + y * y + z * z > FIELD_RADIUS * FIELD_RADIUS) {
        this.resetParticle(index, false);
        x = this.positions[offset];
        y = this.positions[offset + 1];
        z = this.positions[offset + 2];
      } else {
        this.positions[offset] = x;
        this.positions[offset + 1] = y;
        this.positions[offset + 2] = z;
      }

      this.proxy.position.set(x, y, z);
      this.proxy.scale.setScalar(particleScale);
      this.proxy.updateMatrix();
      this.mesh.setMatrixAt(index, this.proxy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  private resetParticle(index: number, scatter: boolean): void {
    const azimuth = Math.random() * Math.PI * 2;
    const polar = Math.acos(Math.random() * 2 - 1);
    const directionX = Math.sin(polar) * Math.cos(azimuth);
    const directionY = Math.cos(polar);
    const directionZ = Math.sin(polar) * Math.sin(azimuth);
    const radius = scatter ? Math.random() * FIELD_RADIUS * 0.9 : 0.3 + Math.random() * 0.5;
    const velocityMagnitude = 0.6 + Math.random() * 1.4;

    const offset = index * 3;
    this.positions[offset] = directionX * radius;
    this.positions[offset + 1] = directionY * radius;
    this.positions[offset + 2] = directionZ * radius;
    this.velocities[offset] = directionX * velocityMagnitude;
    this.velocities[offset + 1] = directionY * velocityMagnitude;
    this.velocities[offset + 2] = directionZ * velocityMagnitude;
  }
}
