// Shared flowing-ribbon shader used by the 2D fallback background and the 3D scene backdrop.
export const RIBBON_FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  float x = uv.x * aspect;

  vec3 col = mix(vec3(0.012, 0.016, 0.04), uA * 0.42, smoothstep(1.25, -0.15, uv.y + (1.0 - uv.x) * 0.35));

  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float y = 0.30 + 0.055 * fi
      + 0.07 * sin(x * 1.25 + uTime * 0.22 + fi * 1.1)
      + 0.035 * sin(x * 2.9 - uTime * 0.16 + fi * 2.3);
    float d = abs(uv.y - y);
    float strength = 0.9 - fi * 0.12;
    vec3 tint = mix(uA, uB, clamp(uv.x + 0.15 * sin(uTime * 0.1 + fi), 0.0, 1.0));
    col += tint * (0.0016 / (d + 0.0025)) * strength * 0.55;
    col += tint * exp(-d * d * 220.0) * 0.07 * strength;
  }

  float v = length((uv - vec2(0.55, 0.55)) * vec2(1.0, 1.25));
  col *= 1.05 - 0.55 * v;
  gl_FragColor = vec4(col, 1.0);
}
`

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
