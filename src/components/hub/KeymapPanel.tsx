import { useState } from 'react';
import { KEY_ACTION_IDS, useHub, type KeyActionId } from '../../store/deviceStore';
import { cidName } from '../../core/hid/remap';
import { t, type I18nKey } from '../../i18n';

/** 鼠标俯视图：通用真机渲染图（public/mouse-generic.png），丑版自绘 SVG 仅作加载失败兜底 */
function BigMouse({ alt }: { alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    const body =
      'M100 20 L134 20 C149 20 157 33 158 54 C159 100 156 140 153 170 C150 222 144 264 136 300 C132 314 118 322 100 322 C82 322 68 314 64 300 C56 264 50 222 47 170 C44 140 41 100 42 54 C43 33 51 20 66 20 Z';
    return (
      <svg viewBox="0 0 200 340" className="h-full w-full">
        <path d={body} fill="#1a1d25" />
        <path d={body} fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="1.5" />
        <path d="M100 21 L100 150" stroke="#06070b" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="86" y="32" width="28" height="74" rx="14" fill="#07080c" />
      </svg>
    );
  }
  return (
    <img
      src={`${import.meta.env.BASE_URL}mouse-generic.png`}
      alt={alt}
      draggable={false}
      onError={() => setFailed(true)}
      className="h-full w-full select-none"
      style={{ objectFit: 'contain' }}
    />
  );
}

/**
 * 锚点全部用鼠标视图百分比表示（相对鼠标包裹层），
 * dot = 鼠标上的按键点位；side = 标签在左/右；dy = 标签垂直微调（%）
 */
type Anchor = { dot: { x: number; y: number }; side: 'left' | 'right'; dy?: number };
const ANCHORS: Record<string, Anchor> = {
  left: { dot: { x: 36, y: 26.5 }, side: 'left' },
  middle: { dot: { x: 50, y: 18.8 }, side: 'right', dy: -7 },
  right: { dot: { x: 64, y: 26.5 }, side: 'right', dy: 5 },
  forward: { dot: { x: 22.5, y: 52 }, side: 'left' },
  back: { dot: { x: 22.5, y: 63 }, side: 'left' },
};

/** 标签 pill 定位样式（左：右缘对齐引导线；右：左缘对齐引导线） */
function labelStyle(a: Anchor): React.CSSProperties {
  const top = `calc(${a.dot.y + (a.dy ?? 0)}% )`;
  return a.side === 'left'
    ? { left: `calc(${a.dot.x}% - 22px)`, top, transform: 'translate(-100%, -50%)' }
    : { left: `calc(${a.dot.x}% + 22px)`, top, transform: 'translateY(-50%)' };
}

/**
 * 改键设置：上半为设备内改键（0x1B04 真键表，按钮互指真写），下半为俯视图主机宏（本地）。
 * 点击胶囊可改功能，底部恢复默认
 */
export default function KeymapPanel() {
  const { keymap, setKeyAction, resetDefaults, saveKeymap, realButtons, writeKeyRemap, busy, locale } = useHub();
  const [editing, setEditing] = useState<string | null>(null);
  const keyLabel = (id: string) => t(locale, (`key.${id}` as I18nKey));

  return (
    <div className="panel-in relative mx-auto w-full max-w-6xl px-5 py-2">
      {realButtons.length > 0 ? (
        <div className="mx-auto mb-2 w-full max-w-3xl rounded-2xl p-4" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)' }}>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>{t(locale, 'keymap.devTitle')}</span>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--text)' }}>
              {t(locale, 'keymap.devCount', { n: realButtons.length })}
            </span>
          </div>
          <p className="mb-3 text-[11px] leading-5" style={{ color: 'var(--text-3)' }}>
            {t(locale, 'keymap.devDesc')}
          </p>
          <div className="flex flex-col gap-2">
            {realButtons.map((k) => {
              const targets = realButtons.map((t) => t.cid);
              const cur = k.mappedTo;
              return (
                <div key={k.cid} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--card)', border: '1px solid var(--card-border)' }}>
                  <span className="min-w-20 text-xs font-bold" style={{ color: 'var(--text)' }}>{cidName(k.cid, locale)}</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>→</span>
                  <select
                    value={cur}
                    disabled={busy}
                    onChange={(e) => writeKeyRemap(k.cid, Number(e.target.value))}
                    className="atk-input rounded-lg px-2 py-1.5 text-xs"
                    title={t(locale, 'keymap.remapToTitle', { name: cidName(k.cid, locale) })}
                  >
                    {targets.map((target) => (
                      <option key={target} value={target}>{cidName(target, locale)}{target === k.cid ? t(locale, 'keymap.defaultSuffix') : ''}</option>
                    ))}
                  </select>
                  {cur !== k.cid && (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(34,197,94,0.15)', color: '#16a34a' }}>
                      {t(locale, 'keymap.remapped')}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--text-3)' }}>0x{k.cid.toString(16)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mx-auto mb-2 w-full max-w-3xl rounded-2xl p-3 text-[11px] leading-5" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)', color: 'var(--text-3)' }}>
          {t(locale, 'keymap.noReal')}
        </div>
      )}

      <div className="mb-1 text-center text-xs font-bold" style={{ color: 'var(--text-2)' }}>{t(locale, 'keymap.macroTitle')}</div>

      <div className="grid place-items-center py-2">
        {/* 白底产品图卡：锚点仍按内层鼠标视图百分比落位 */}
        <div className="rounded-[28px] px-8 py-5" style={{ background: '#ffffff', boxShadow: 'var(--shadow-card)', border: '1px solid var(--card-border)' }}>
        <div className="relative" style={{ width: 259, height: 440 }}>
          <div
            className="h-full w-full overflow-hidden rounded-[20px]"
            style={{ background: '#ffffff' }}
          >
            <BigMouse alt={t(locale, 'keymap.mouseAlt')} />
          </div>
          {keymap.map((k) => {
            const a = ANCHORS[k.id];
            if (!a) return null;
            return (
              <div key={k.id}>
                {/* 按键点位 */}
                <span
                  className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    left: `${a.dot.x}%`,
                    top: `${a.dot.y}%`,
                    background: 'var(--accent)',
                    boxShadow: '0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent), 0 0 12px var(--accent)',
                  }}
                />
                {/* 引导虚线 */}
                <span
                  className="absolute"
                  style={
                    a.side === 'left'
                      ? { left: `calc(${a.dot.x}% - 22px)`, top: `${a.dot.y}%`, width: 16, borderTop: '1.5px dashed var(--text-3)', opacity: 0.7 }
                      : { left: `calc(${a.dot.x}% + 7px)`, top: `${a.dot.y}%`, width: 15, borderTop: '1.5px dashed var(--text-3)', opacity: 0.7 }
                  }
                />
                {/* 功能标签 */}
                <button
                  onClick={() => setEditing(editing === k.id ? null : k.id)}
                  className="absolute rounded-xl px-3 py-1.5 text-center transition hover:scale-105"
                  style={{
                    ...labelStyle(a),
                    background: 'var(--card)',
                    border: `1px solid ${editing === k.id ? 'var(--accent)' : 'var(--card-border)'}`,
                    boxShadow: 'var(--shadow-card)',
                    backdropFilter: 'blur(14px)',
                    minWidth: 68,
                  }}
                >
                  <span className="block text-[10px]" style={{ color: 'var(--text-3)' }}>{keyLabel(k.id)}</span>
                  <span className="block text-[13px] font-black" style={{ color: 'var(--text)' }}>{keyLabel(k.action)}</span>
                </button>
                {editing === k.id && (
                  <span
                    className="glass absolute z-10 block w-44 rounded-xl p-2"
                    style={{
                      ...(a.side === 'left'
                        ? { left: `calc(${a.dot.x}% - 22px)`, transform: 'translate(-100%, 0)' }
                        : { left: `calc(${a.dot.x}% + 22px)` }),
                      top: `calc(${a.dot.y + (a.dy ?? 0)}% + 26px)`,
                    }}
                  >
                    {KEY_ACTION_IDS.map((opt: KeyActionId) => (
                      <button
                        key={opt}
                        onClick={() => {
                          setKeyAction(k.id, opt);
                          setEditing(null);
                        }}
                        className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:opacity-75"
                        style={{
                          background: opt === k.action ? 'var(--accent-soft)' : 'transparent',
                          color: 'var(--text)',
                        }}
                      >
                        {keyLabel(opt)}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3 pb-6">
        <button
          onClick={resetDefaults}
          title={t(locale, 'keymap.resetDpiTitle')}
          className="btn-ghost rounded-lg px-5 py-2 text-xs"
        >
          {t(locale, 'keymap.resetDpi')}
        </button>
        <button
          onClick={saveKeymap}
          className="btn-pill rounded-lg px-5 py-2 text-xs font-bold"
          title={t(locale, 'keymap.saveKeysTitle')}
        >
          {t(locale, 'keymap.saveKeys')}
        </button>
      </div>
    </div>
  );
}
