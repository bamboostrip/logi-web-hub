import { useEffect, useRef, useState } from 'react';
import { BG_FRAG, BG_VERT, dpiToHue, dpiToSpeed } from '../../shaders/glsl';
import { useHub } from '../../store/deviceStore';

/**
 * 全屏 WebGL 背景：随 currentDpi 变色 + 变速，随主题深浅切换底色。
 * 独立 canvas + rAF，不进 React 渲染循环，避免 HID 轮询被卡。
 * WebGL 不可用时降级为 CSS 渐变（.shader-fallback）。
 */
export default function ShaderBackground() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  // 订阅以触发重渲染（主题过渡在帧循环内用 getState 平滑插值）
  useHub((s) => s.currentDpi);
  const theme = useHub((s) => s.theme);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl', { antialias: false });
    } catch {
      gl = null;
    }
    if (!gl) {
      setFailed(true);
      return;
    }
    const ctx = gl as WebGLRenderingContext;

    const compile = (type: number, src: string) => {
      const sh = ctx.createShader(type)!;
      ctx.shaderSource(sh, src);
      ctx.compileShader(sh);
      return sh;
    };
    const prog = ctx.createProgram()!;
    ctx.attachShader(prog, compile(ctx.VERTEX_SHADER, BG_VERT));
    ctx.attachShader(prog, compile(ctx.FRAGMENT_SHADER, BG_FRAG));
    ctx.linkProgram(prog);
    if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    ctx.useProgram(prog);

    const buf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
    const loc = ctx.getAttribLocation(prog, 'p');
    ctx.enableVertexAttribArray(loc);
    ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);

    const uRes = ctx.getUniformLocation(prog, 'uRes');
    const uTime = ctx.getUniformLocation(prog, 'uTime');
    const uHue = ctx.getUniformLocation(prog, 'uHue');
    const uSpeed = ctx.getUniformLocation(prog, 'uSpeed');
    const uLight = ctx.getUniformLocation(prog, 'uLight');

    let raf = 0;
    const t0 = performance.now();
    let light = useHub.getState().theme === 'light' ? 1 : 0;
    const resize = () => {
      // 移动端降 dpr 保帧率（规范要求）
      const isMobile = window.innerWidth < 768;
      const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    const frame = () => {
      const st = useHub.getState();
      const target = st.theme === 'light' ? 1 : 0;
      // 主题平滑过渡，避免黑白闪
      light += (target - light) * 0.06;
      const hue = dpiToHue(st.currentDpi);
      const speed = dpiToSpeed(st.currentDpi);
      ctx.uniform2f(uRes, canvas.width, canvas.height);
      ctx.uniform1f(uTime, (performance.now() - t0) / 1000);
      ctx.uniform1f(uHue, hue);
      ctx.uniform1f(uSpeed, speed);
      ctx.uniform1f(uLight, light);
      ctx.drawArrays(ctx.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      ctx.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  if (failed) {
    return <div className="shader-fallback pointer-events-none fixed inset-0" aria-hidden />;
  }

  return (
    <canvas
      ref={ref}
      key={theme}
      className="pointer-events-none fixed inset-0 h-full w-full"
      style={{ width: '100vw', height: '100vh' }}
    />
  );
}
