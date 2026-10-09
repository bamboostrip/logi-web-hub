/**
 * 背景 shader：DPI 越高 hue 越冷、流速越快。
 * ATK 风格：暗底流光 + 细网格；浅色模式转为浅灰底 + 淡彩流光（对标截图）。
 * uLight: 0 = 深色，1 = 浅色，由主题平滑过渡。
 */

/** DPI -> hue：400绿 / 800青 / 1600蓝 / 3200紫 / 6400+品红 */
export function dpiToHue(dpi: number): number {
  if (dpi <= 400) return 150;
  if (dpi <= 800) return 185;
  if (dpi <= 1600) return 215;
  if (dpi <= 3200) return 265;
  return 300;
}

/** DPI -> 流速 0.4 ~ 1.6 */
export function dpiToSpeed(dpi: number): number {
  const t = Math.min(Math.max((dpi - 200) / (6400 - 200), 0), 1);
  return 0.4 + t * 1.2;
}

export const BG_FRAG = /* glsl */ `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uHue;   // 0..360
uniform float uSpeed;  // 0.4..1.6
uniform float uLight;  // 0 dark, 1 light

vec3 hsv(float h, float s, float v){
  vec3 k = clamp(abs(mod(h/60.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}

void main(){
  vec2 uv = (gl_FragCoord.xy / uRes);
  uv.x *= uRes.x / uRes.y;
  float t = uTime * uSpeed;
  float w1 = sin(uv.x*3.0 + t*0.8) * sin(uv.y*2.2 - t*0.6);
  float w2 = sin((uv.x+uv.y)*4.5 - t*1.1);
  float glow = smoothstep(0.2, 1.0, 0.55 + 0.28*w1 + 0.17*w2);

  vec3 darkBase = vec3(0.012, 0.02, 0.045);
  vec3 lightBase = vec3(0.933, 0.941, 0.953); // #eef0f3 对标截图
  vec3 base = mix(darkBase, lightBase, uLight);

  vec3 darkCol = hsv(uHue, 0.75, 0.5);
  vec3 lightCol = hsv(uHue, 0.45, 0.75);
  vec3 col = mix(darkCol, lightCol, uLight);

  float strength = mix(0.55, 0.35, uLight);
  vec3 outc = base + col * glow * strength;

  // 细网格线：深色加亮，浅色加深
  float grid = smoothstep(0.985, 1.0, fract(uv.y*40.0));
  outc += grid * mix(0.05, 0.03, uLight) * mix(vec3(1.0), vec3(0.2,0.25,0.4), uLight);

  // 浅色模式叠一层顶部高光，模拟截图的柔光
  float top = smoothstep(1.2, 0.2, uv.y) * uLight * 0.06;
  outc += top;

  gl_FragColor = vec4(outc, 1.0);
}
`;

export const BG_VERT = /* glsl */ `
attribute vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }
`;
