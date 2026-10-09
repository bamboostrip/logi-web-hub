import { useHub } from '../../store/deviceStore';
import { t } from '../../i18n';

/** 其他设置：主题 / 语言 / 数据 / 关于 + 设置弹窗内容复用 */
export function OtherPanel() {
  const { theme, setTheme, resetDefaults, disconnect, connected, locale, setLocale } = useHub();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-5 py-4">
      <h2 className="text-[15px] font-black" style={{ color: 'var(--text)' }}>{t(locale, 'other.title')}</h2>
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)' }}>
        <div className="mb-2 text-sm font-bold" style={{ color: 'var(--text)' }}>{t(locale, 'other.themeTitle')}</div>
        <div className="flex gap-2">
          {(['light', 'dark'] as const).map((tm) => (
            <button
              key={tm}
              onClick={() => setTheme(tm)}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold ${theme === tm ? 'btn-pill' : 'btn-ghost'}`}
            >
              {tm === 'light' ? t(locale, 'other.light') : t(locale, 'other.dark')}
            </button>
          ))}
        </div>
        <div className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
          {t(locale, 'other.themeDesc')}
        </div>
      </div>
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)' }}>
        <div className="mb-2 text-sm font-bold" style={{ color: 'var(--text)' }}>{t(locale, 'other.langTitle')}</div>
        <div className="flex gap-2">
          {(['zh', 'en'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold ${locale === l ? 'btn-pill' : 'btn-ghost'}`}
            >
              {l === 'zh' ? '中文' : 'English'}
            </button>
          ))}
        </div>
        <div className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
          {t(locale, 'other.langDesc')}
        </div>
      </div>
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)' }}>
        <div className="mb-2 text-sm font-bold" style={{ color: 'var(--text)' }}>{t(locale, 'other.dataTitle')}</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={resetDefaults} className="btn-ghost rounded-lg px-4 py-1.5 text-xs">
            {t(locale, 'other.reset')}
          </button>
          <button
            onClick={() => {
              try {
                localStorage.clear();
              } catch { /* ignore */ }
              location.reload();
            }}
            className="btn-ghost rounded-lg px-4 py-1.5 text-xs"
          >
            {t(locale, 'other.clearCache')}
          </button>
          {connected && (
            <button
              onClick={disconnect}
              className="rounded-lg px-4 py-1.5 text-xs font-bold text-white"
              style={{ background: '#ff5a5a' }}
            >
              {t(locale, 'other.disconnect')}
            </button>
          )}
        </div>
      </div>
      <div className="rounded-xl p-4 text-[11px] leading-5" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)', color: 'var(--text-3)' }}>
        {t(locale, 'other.about')}
      </div>
    </div>
  );
}

/** 右上齿轮弹出的设置抽屉 */
export function SettingsDrawer() {
  const { showSettings, setShowSettings, locale } = useHub();
  if (!showSettings) return null;
  return (
    <div className="fixed inset-0 z-50" onClick={() => setShowSettings(false)}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.35)' }} />
      <div
        className="glass absolute right-0 top-0 h-full w-[320px] overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-black" style={{ color: 'var(--text)' }}>{t(locale, 'other.settings')}</span>
          <button onClick={() => setShowSettings(false)} className="opacity-60 hover:opacity-100">✕</button>
        </div>
        <OtherPanel />
      </div>
    </div>
  );
}
