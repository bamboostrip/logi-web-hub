import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useHub, type HubTab } from '../../store/deviceStore';
import { t, type I18nKey } from '../../i18n';

const NAV: Array<{ id: HubTab; labelKey: I18nKey; icon: string }> = [
  { id: 'diag', labelKey: 'nav.diag', icon: '🩺' },
  { id: 'dpi', labelKey: 'nav.dpi', icon: '🎯' },
  { id: 'keymap', labelKey: 'nav.keymap', icon: '🖱' },
  { id: 'performance', labelKey: 'nav.performance', icon: '◉' },
  { id: 'params', labelKey: 'nav.params', icon: '☰' },
  { id: 'profiles', labelKey: 'nav.profiles', icon: '▦' },
  { id: 'other', labelKey: 'nav.other', icon: '⚙' },
];

export default function SideBar() {
  const { tab, setTab, info, battery, batteryMethod, profileIndex, setProfileIndex, connected, realHid, presets, onboardRealCount, supportsLighting, onboardMode, rgbZoneCount, locale } = useHub();
  const [configOpen, setConfigOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const configBtnRef = useRef<HTMLButtonElement>(null);
  const configPopRef = useRef<HTMLDivElement>(null);
  const [configPos, setConfigPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  // 不同鼠标板载槽位数不同（G304 仅 1 组，GPW 5 组），侧边栏按机型档案动态渲染
  const profileCount = info?.onboardProfiles ?? 1;
  const safeIndex = profileIndex >= 0 && profileIndex < profileCount ? profileIndex : 0;

  // 机型切换导致旧 index 越界时自动归零，避免卡在不存在的槽位
  useEffect(() => {
    if (profileIndex !== safeIndex) setProfileIndex(safeIndex);
  }, [profileIndex, safeIndex, setProfileIndex]);

  // 弹出层挂到 body 并用 fixed 定位：侧边栏 overflow-y-auto 会把 absolute 子元素裁剪在 208px 内
  const toggleConfig = () => {
    const rect = configBtnRef.current?.getBoundingClientRect();
    if (rect) setConfigPos({ left: rect.left + 40, top: rect.top });
    setConfigOpen((v) => !v);
  };

  // 点击弹层与触发按钮之外的区域时关闭
  useEffect(() => {
    if (!configOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (configPopRef.current?.contains(target)) return;
      if (configBtnRef.current?.contains(target)) return;
      setConfigOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [configOpen]);

  if (!connected) return null;

  return (
    <aside
      className="flex w-[208px] shrink-0 flex-col gap-1 overflow-y-auto p-2 text-[13px]"
      style={{ background: 'color-mix(in srgb, var(--bg-soft) 70%, var(--bg))', color: 'var(--text-2)' }}
    >
      <button
        onClick={() => setDeviceOpen((v) => !v)}
        className="rounded-lg px-3 py-2 text-left hover:opacity-80"
        style={{ background: 'var(--input-bg)' }}
      >
        <div className="flex items-center justify-between text-xs">
          <span>🔋 {battery != null ? `${battery}%` : '--'}</span>
          <span>{deviceOpen ? '﹀' : '﹥'}</span>
        </div>
        <div className="truncate text-xs font-bold" style={{ color: 'var(--text)' }}>
          {info?.name ?? t(locale, 'side.unknownDevice')}
        </div>
        {deviceOpen && (
          <div className="mt-1 text-[11px] leading-5 opacity-80">
            {t(locale, 'side.source')}{realHid ? `${t(locale, 'side.sourceReal')}${batteryMethod ? `（${batteryMethod}）` : ''}` : t(locale, 'side.sourceLocal')}
            <br />
            {(info?.hasRgb || supportsLighting) ? t(locale, 'side.hasRgb') : t(locale, 'side.noRgb')}
            {supportsLighting && !info?.hasRgb ? t(locale, 'side.measured') : ''}{rgbZoneCount != null && rgbZoneCount > 0 ? t(locale, 'side.rgbReadonly') : ''}
            <br />
            {t(locale, 'side.boardGroups', { n: profileCount })}{onboardRealCount != null ? t(locale, 'side.boardReal') : t(locale, 'side.boardFile')}{onboardMode === 0x01 ? t(locale, 'side.boardActive') : onboardMode === 0x02 ? t(locale, 'side.hostTakeover') : ''}{t(locale, 'side.dpiSlots', { n: info?.dpiSlots ?? 4 })}
            <br />
            {t(locale, 'side.rangeStep', { min: info?.dpiMin ?? 100, max: info?.dpiMax ?? 16000, step: info?.dpiStep ?? 50 })}
          </div>
        )}
      </button>

      <div className="relative">
        <button
          ref={configBtnRef}
          onClick={toggleConfig}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 hover:opacity-80"
          title={profileCount > 1
            ? t(locale, 'side.configTipMulti', { n: profileCount, cur: safeIndex + 1 })
            : t(locale, 'side.configTipSingle')}
        >
          <span>
            {t(locale, 'side.onboardConfig', { cur: safeIndex + 1 })}
            <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--text)' }}>
              {profileCount > 1 ? t(locale, 'side.localShort', { cur: safeIndex + 1, total: profileCount }) : t(locale, 'side.localBadge')}
            </span>
          </span>
          <span>{configOpen ? '﹀' : '﹥'}</span>
        </button>
        {configOpen &&
          createPortal(
            <div
              ref={configPopRef}
              className="glass fixed z-40 w-72 rounded-xl p-3"
              style={{ left: configPos.left, top: configPos.top, color: 'var(--text-2)' }}
            >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                {t(locale, 'side.configTitle', { n: profileCount })}
              </span>
              <button className="text-xs opacity-70 hover:opacity-100" onClick={() => { setTab('profiles'); setConfigOpen(false); }}>
                {t(locale, 'side.manageProfiles')}
              </button>
            </div>
            <p className="mb-2 text-[11px] leading-4 opacity-70">
              {profileCount > 1
                ? t(locale, 'side.configRuleMulti')
                : t(locale, 'side.configRuleSingle')}
            </p>
            <div className="mt-1 flex flex-col gap-1.5">
              {Array.from({ length: profileCount }, (_, i) => {
                const active = i === safeIndex;
                return (
                  <button
                    key={i}
                    onClick={() => {
                      setProfileIndex(i);
                      setConfigOpen(false);
                    }}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-xs"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'var(--input-bg)',
                      border: active ? '1px solid var(--accent)' : '1px solid transparent',
                      color: 'var(--text)',
                    }}
                    title={active ? t(locale, 'side.editingNow', { cur: i + 1 }) : t(locale, 'side.switchTo', { cur: i + 1 })}
                  >
                    <span className="flex items-center gap-2 font-bold">
                      {t(locale, 'side.onboardConfig', { cur: i + 1 })}
                      {active && (
                        <span className="rounded-full bg-green-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {t(locale, 'side.localBadge')}
                        </span>
                      )}
                    </span>
                    <span className="max-w-[130px] truncate text-[11px] opacity-70">
                      {active ? t(locale, 'side.dpiPreview', { v: presets.join(' / ') }) : t(locale, 'side.clickSwitch')}
                    </span>
                  </button>
                );
              })}
            </div>
            </div>,
            document.body
          )}
      </div>

      <div className="px-3 pb-1 pt-2 text-[11px] opacity-60">{t(locale, 'top.mouseConfig')}</div>
      {NAV.map((n) => {
        const active = tab === n.id;
        return (
          <button
            key={n.id}
            onClick={() => setTab(n.id)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left"
            style={{
              background: active ? 'var(--input-bg)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-2)',
              fontWeight: active ? 700 : 400,
            }}
          >
            <span className="w-4 text-center">{n.icon}</span>
            {t(locale, n.labelKey)}
          </button>
        );
      })}
    </aside>
  );
}
