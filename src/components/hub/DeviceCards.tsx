import { motion } from 'framer-motion';
import { useHub } from '../../store/deviceStore';
import { SUPPORTED_DEVICES } from '../../core/hid/devices';
import { t } from '../../i18n';

/** 鼠标剪影（深色纯黑 / 浅色同步加深） */
function MouseShape({ dark }: { dark: boolean }) {
  return (
    <svg viewBox="0 0 120 200" className="h-44 w-auto" style={{ filter: dark ? 'none' : 'drop-shadow(0 12px 24px rgba(0,0,0,0.25))' }}>
      <ellipse cx="60" cy="100" rx="38" ry="88" fill={dark ? '#0b0c0e' : '#17181c'} />
      <ellipse cx="60" cy="100" rx="38" ry="88" fill="url(#g)" opacity="0.35" />
      <rect x="58.5" y="14" width="3" height="118" fill={dark ? '#000' : '#0a0a0c'} opacity="0.9" />
      <rect x="52" y="26" width="16" height="26" rx="7" fill={dark ? '#16171a' : '#232428'} />
      <rect x="55" y="30" width="10" height="6" rx="3" fill={dark ? '#2a2c31' : '#3a3b41'} />
      <defs>
        <radialGradient id="g" cx="0.5" cy="0.4" r="0.8">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="60%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/**
 * 首页：只有一个「连接设备」入口。授权框已按 usagePage 0xff00 过滤，
 * 接收器只显示一个条目；型号识别（HID++ 设备名）、电量、DPI 全部自动完成。
 * 已授权过的设备在页面加载时自动连接，无需再点。
 */
export default function DeviceCards() {
  const { connect, busy, theme, status, locale } = useHub();
  const dark = theme === 'dark';

  return (
    <div className="relative z-10 mx-auto w-full max-w-3xl px-4 pt-10 md:px-8 md:pt-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-2xl"
        style={{
          background: dark ? 'rgba(255,255,255,0.04)' : '#e4e6eb',
          border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
        }}
      >
        <div
          className="grid h-72 w-full place-items-center"
          style={{ background: dark ? 'rgba(255,255,255,0.03)' : '#eceef1' }}
        >
          <MouseShape dark={dark} />
        </div>
        <div className="px-5 py-4" style={{ background: dark ? 'rgba(0,0,0,0.35)' : '#dfe1e6' }}>
          <div className="text-[17px] font-black tracking-tight" style={{ color: 'var(--text)' }}>
            {t(locale, 'home.connectTitle')}
          </div>
          <div className="mb-3 text-[11px] leading-5" style={{ color: 'var(--text-3)' }}>
            {t(locale, 'home.connectDesc')}
          </div>
          <button
            className="btn-pill w-full rounded-lg px-3 py-2.5 text-sm font-bold disabled:opacity-50"
            disabled={busy}
            onClick={() => connect()}
            title={t(locale, 'home.connectTitleAttr')}
          >
            {busy ? t(locale, 'home.connecting') : t(locale, 'home.connect')}
          </button>
          <div className="mt-2 text-center text-[11px]" style={{ color: 'var(--text-3)' }}>
            {status}
          </div>
        </div>
      </motion.div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          {t(locale, 'home.verified', { v: SUPPORTED_DEVICES.map((d) => d.name).join(' · ') })}
        </span>
      </div>
      <p className="mt-10 pb-6 text-center text-xs" style={{ color: 'var(--text-3)' }}>
        {t(locale, 'home.btNote')}
      </p>
    </div>
  );
}
