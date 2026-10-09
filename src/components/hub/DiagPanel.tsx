import { useState } from 'react';
import { canonicalProfileKey, DEFAULT_PRESETS } from '../../core/hid/devices';
import { useHub } from '../../store/deviceStore';
import { t } from '../../i18n';

const DETAIL_KEY = 'logi-web-hub:diag-detail';

function loadDetailPref(): boolean {
  try {
    return localStorage.getItem(DETAIL_KEY) === '1';
  } catch {
    return false;
  }
}

/** 设备短名：命中型号家族（如 G304 / G305 Lightspeed）就显示家族，否则显示 HID 全名 */
export function shortDeviceName(hidName: string | null, fallback: string | undefined): string {
  const key = canonicalProfileKey(hidName ?? fallback);
  if (key && DEFAULT_PRESETS[key]) return key;
  return hidName ?? fallback ?? '--';
}

function StatCard({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="min-w-0 rounded-2xl p-4" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)' }}>
      <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div className={`font-dpi mt-0.5 font-black ${valueClass ?? 'text-3xl'}`} style={{ color: 'var(--text)' }}>{value}</div>
      {sub && <div className="mt-0.5 break-words text-[11px] leading-4" style={{ color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  );
}

/**
 * 设备自检：默认简洁视图（普通用户只看数值：电量 / DPI / 回报率 / 设备状态），
 * 打开「查看详情（开发人员）」才显示逐项自检步骤与原始报文。
 */
export default function DiagPanel() {
  const {
    diagnostics, diagRunning, runSelfTest, connected, battery, batteryStatusText, batteryMethod,
    currentDpi, presets, pollingRate, pollingReal, realHid, hidName, protocol, status, info, locale,
  } = useHub();
  const [showDetail, setShowDetail] = useState(loadDetailPref);

  const toggleDetail = () => {
    const next = !showDetail;
    setShowDetail(next);
    try {
      localStorage.setItem(DETAIL_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const failCount = diagnostics.filter((d) => !d.ok).length;
  const devShort = shortDeviceName(hidName, info?.name);

  return (
    <div className="panel-in mx-auto w-full max-w-3xl px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-black" style={{ color: 'var(--text)' }}>{t(locale, 'diag.title')}</h2>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
            {diagRunning
              ? t(locale, 'diag.testing')
              : realHid
                ? `${t(locale, 'diag.liveHid')}${protocol ? `（HID++ ${protocol}）` : ''}`
                : t(locale, 'diag.localData')}
            {!diagRunning && diagnostics.length > 0 && failCount === 0 && t(locale, 'diag.allOk')}
            {!diagRunning && failCount > 0 && t(locale, 'diag.failN', { n: failCount })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
            {t(locale, 'diag.showDetail')}
            <button
              role="switch"
              aria-checked={showDetail}
              onClick={toggleDetail}
              className="relative h-5 w-9 rounded-full transition"
              style={{ background: showDetail ? 'var(--pill-bg)' : 'rgba(130,140,160,0.4)' }}
            >
              <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow" style={{ left: showDetail ? 18 : 2 }} />
            </button>
          </label>
          <button
            onClick={runSelfTest}
            disabled={!connected || diagRunning}
            className="btn-pill rounded-lg px-4 py-1.5 text-xs font-bold disabled:opacity-40"
          >
            {diagRunning ? t(locale, 'diag.testing') : t(locale, 'diag.retest')}
          </button>
        </div>
      </div>

      {!connected && (
        <div className="mb-3 rounded-2xl p-4 text-xs" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)', color: 'var(--text-2)' }}>
          {t(locale, 'diag.notConnected')}
        </div>
      )}

      {/* 普通用户视图：只看关键数值 */}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label={`${t(locale, 'diag.battery')}${batteryMethod ? `（${batteryMethod}）` : ''}`}
          value={battery != null ? `${battery}%` : t(locale, 'diag.batteryUnknown')}
          sub={batteryStatusText ?? (battery != null ? '' : t(locale, 'diag.batteryUnknown'))}
        />
        <StatCard
          label={t(locale, 'diag.dpiNow')}
          value={String(currentDpi)}
          sub={t(locale, 'diag.dpiSlots', { v: presets.join(' / ') || t(locale, 'diag.dpiNone') })}
        />
        <StatCard
          label={t(locale, 'diag.rate')}
          value={`${pollingRate}Hz`}
          sub={pollingReal ? t(locale, 'diag.rateReal') : t(locale, 'diag.rateLocal')}
        />
        <StatCard
          label={t(locale, 'diag.device')}
          value={devShort}
          valueClass="text-xl leading-6"
          sub={`${hidName && hidName !== devShort ? `${hidName} · ` : ''}${t(locale, 'diag.boardInfo', { n: info?.onboardProfiles ?? 1 })} · ${realHid ? t(locale, 'diag.hidReal') : t(locale, 'diag.localMode')}`}
        />
      </div>

      {!showDetail && (
        <p className="text-[11px] leading-5" style={{ color: 'var(--text-3)' }}>
          {status}
          {failCount > 0 && t(locale, 'diag.failHint')}
        </p>
      )}

      {/* 开发人员视图：逐项步骤 + 原始报文 */}
      {showDetail && (
        <>
          <div className="flex flex-col gap-2">
            {diagnostics.map((s, i) => (
              <div
                key={i}
                className="rounded-2xl p-3"
                style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)' }}
              >
                <div className="flex items-start gap-2">
                  <span>{s.ok ? '✅' : '❌'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>{s.name}</div>
                    <div className="mt-0.5 text-xs leading-5" style={{ color: 'var(--text-2)' }}>{s.detail}</div>
                    {s.raw && (
                      <pre
                        className="mt-1.5 overflow-x-auto rounded-lg p-2 font-mono text-[11px] leading-5"
                        style={{ background: 'var(--input-bg)', color: 'var(--text-2)' }}
                      >
                        {s.raw}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {diagnostics.length === 0 && !diagRunning && connected && (
              <div className="text-xs" style={{ color: 'var(--text-3)' }}>{t(locale, 'diag.noRecord')}{status}</div>
            )}
          </div>

          <p className="mt-4 text-[11px] leading-5" style={{ color: 'var(--text-3)' }}>
            {t(locale, 'diag.protoNote')}
          </p>
        </>
      )}
    </div>
  );
}
