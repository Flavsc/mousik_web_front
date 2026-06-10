import { SIMPLEX_NOISE_GLSL } from './simplex-noise.glsl';

export const REACTIVE_NOISE_SHADER = {
  name: 'MousikReactiveNoiseShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRms: { value: 0 }
  },
  vertexShader: `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uRms;
${SIMPLEX_NOISE_GLSL}

void main() {
  vec2 warpOffset = vec2(
    snoise(vec3(vUv * 4.0, uTime * 0.9)),
    snoise(vec3(vUv * 4.0 + 13.7, uTime * 0.9))
  ) * uRms * 0.012;
  vec3 color = texture2D(tDiffuse, vUv + warpOffset).rgb;
  float grain = snoise(vec3(vUv * 320.0, uTime * 7.0));
  color += grain * uRms * 0.18;
  gl_FragColor = vec4(color, 1.0);
}
`
};
