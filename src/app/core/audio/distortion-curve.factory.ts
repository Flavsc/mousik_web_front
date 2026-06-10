const CURVE_RESOLUTION = 8193;

export function createPolynomialDistortionCurve(
  drive: number,
  polynomialOrder: number
): Float32Array<ArrayBuffer> {
  const order = Math.max(1, Math.floor(polynomialOrder));
  const normalizedDrive = Math.min(1, Math.max(0, drive));

  const weights = new Float64Array(order + 1);
  weights[1] = 1;
  for (let n = 2; n <= order; n += 1) {
    weights[n] = Math.pow(normalizedDrive, n - 1) / n;
  }

  const raw = new Float64Array(CURVE_RESOLUTION);
  for (let index = 0; index < CURVE_RESOLUTION; index += 1) {
    const x = (index / (CURVE_RESOLUTION - 1)) * 2 - 1;
    let chebyshevPrevious = 1;
    let chebyshevCurrent = x;
    let accumulated = 0;
    for (let n = 1; n <= order; n += 1) {
      accumulated += weights[n] * chebyshevCurrent;
      const chebyshevNext = 2 * x * chebyshevCurrent - chebyshevPrevious;
      chebyshevPrevious = chebyshevCurrent;
      chebyshevCurrent = chebyshevNext;
    }
    raw[index] = accumulated;
  }

  const dcOffset = raw[(CURVE_RESOLUTION - 1) / 2];
  let peak = 0;
  for (let index = 0; index < CURVE_RESOLUTION; index += 1) {
    raw[index] -= dcOffset;
    peak = Math.max(peak, Math.abs(raw[index]));
  }

  const curve = new Float32Array(CURVE_RESOLUTION);
  const normalization = peak > 0 ? 1 / peak : 1;
  for (let index = 0; index < CURVE_RESOLUTION; index += 1) {
    curve[index] = raw[index] * normalization;
  }
  return curve;
}
