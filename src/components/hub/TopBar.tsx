import { useHub } from '../../store/deviceStore';
import { t } from '../../i18n';

function IconSun() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function IconMoon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function IconGear() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

/** 顶栏：logo + 页签 + 真实连接状态胶囊 + 语言 + 主题 + 设置 */
export default function TopBar() {
  const { theme, toggleTheme, tab, setTab, connected, info, battery, realHid, disconnect, locale, setLocale } = useHub();

  return (
    <header
      className="relative z-20 flex h-12 items-center justify-between gap-2 px-3"
      style={{ background: 'color-mix(in srgb, var(--bg) 88%, transparent)', backdropFilter: 'blur(12px)' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex shrink-0 items-center gap-1.5">
          <span style={{ color: '#ff6a00', fontSize: 20, lineHeight: 1 }}>⚡</span>
          <span className="text-[13px] font-black tracking-wider" style={{ color: 'var(--text)' }}>
            LOGI GEAR
          </span>
        </div>
        <button
          onClick={() => setTab('home')}
          className="hidden items-center gap-1 rounded-full px-3 py-1 text-xs sm:flex"
          style={{
            background: tab === 'home' ? 'var(--input-bg)' : 'transparent',
            color: 'var(--text-2)',
          }}
        >
          <span className="text-[13px]">↻</span> {t(locale, 'nav.home')}
        </button>
        {connected && info && (
          <button
            onClick={() => setTab('diag')}
            className="flex max-w-[180px] items-center gap-2 rounded-full px-3 py-1 text-xs"
            style={{ background: 'var(--input-bg)', color: 'var(--text)' }}
            title={info.name}
          >
            <span className="truncate">{info.name.length > 14 ? `${info.name.slice(0, 14)}…` : info.name}</span>
            <span
              role="button"
              aria-label={t(locale, 'top.disconnect')}
              className="opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                disconnect();
              }}
            >
              ✕
            </span>
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
        <button
          onClick={() => (connected ? setTab('diag') : setTab('home'))}
          className="btn-pill rounded-md px-3 py-1.5 text-xs font-bold"
          title={connected ? t(locale, 'top.viewDiag') : t(locale, 'top.backHome')}
        >
          {!connected ? (
            <>{t(locale, 'top.unconnected')}</>
          ) : (
            <>
              <span style={{ color: realHid ? '#7dffb0' : '#ffa940' }}>●</span> {info?.name ?? t(locale, 'top.connectedFallback')}
              {battery != null ? ` · ${battery}%` : t(locale, 'top.batteryUnknown')}
            </>
          )}
        </button>

        <button
          onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          className="rounded-lg px-2 py-1.5 text-xs font-bold hover:opacity-70"
          style={{ color: 'var(--text-2)' }}
          title={t(locale, 'top.lang')}
        >
          {locale === 'zh' ? 'EN' : '中'}
        </button>
        <button onClick={toggleTheme} className="rounded-lg p-2 hover:opacity-70" style={{ color: 'var(--text-2)' }} title={theme === 'light' ? t(locale, 'top.themeToDark') : t(locale, 'top.themeToLight')}>
          {theme === 'light' ? <IconSun /> : <IconMoon />}
        </button>
        <button
          onClick={() => useHub.getState().setShowSettings(true)}
          className="rounded-lg p-2 hover:opacity-70"
          style={{ color: 'var(--text-2)' }}
          title={t(locale, 'top.settings')}
        >
          <IconGear />
        </button>
      </div>
    </header>
  );
}
