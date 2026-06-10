import { Vector2 } from 'three';

export const CRT_SHADER = {
  name: 'MousikCrtShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
    uCurvature: { value: 0.12 },
    uScanlineIntensity: { value: 0.22 },
    uRgbShift: { value: 0.0012 }
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
uniform vec2 uResolution;
uniform float uCurvature;
uniform float uScanlineIntensity;
uniform float uRgbShift;

const float PI = 3.141592653589793;

vec2 applyBarrelDistortion(vec2 uv) {
  vec2 centered = uv * 2.0 - 1.0;
  float radiusSquared = dot(centered, centered);
  centered *= 1.0 + uCurvature * radiusSquared;
  return centered * 0.5 + 0.5;
}

void main() {
  vec2 uv = applyBarrelDistortion(vUv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 shift = vec2(uRgbShift, 0.0);
  float red = texture2D(tDiffuse, uv + shift).r;
  float green = texture2D(tDiffuse, uv).g;
  float blue = texture2D(tDiffuse, uv - shift).b;
  vec3 color = vec3(red, green, blue);
  float scanline = 0.5 + 0.5 * sin(uv.y * uResolution.y * PI);
  color *= 1.0 - uScanlineIntensity * scanline;
  float vignette = smoothstep(0.85, 0.35, length(vUv - 0.5));
  color *= mix(0.72, 1.0, vignette);
  color *= 1.0 + 0.015 * sin(uTime * 120.0);
  gl_FragColor = vec4(color, 1.0);
}
`
};
