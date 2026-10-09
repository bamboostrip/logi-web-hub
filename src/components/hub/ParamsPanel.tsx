import { useHub } from '../../store/deviceStore';
import { t } from '../../i18n';

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="relative h-5 w-9 shrink-0 rounded-full transition"
      style={{ background: on ? 'var(--pill-bg)' : 'rgba(130,140,160,0.4)' }}
    >
      <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow" style={{ left: on ? 18 : 2 }} />
    </button>
  );
}

/** 参数设置：休眠 / 直线修正（本地）+ LOD（有 0x2202 则真写）/ 低电量提醒 */
export default function ParamsPanel() {
  const { sleepMinutes, setSleepMinutes, lod, writeLod, lodSupported, lodReal, angleSnap, setAngleSnap, lowBatteryAlert, setLowBatteryAlert, info, locale } = useHub();
  return (
    <div className="panel-in mx-auto flex w-full max-w-3xl flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-[15px] font-black" style={{ color: 'var(--text)' }}>{t(locale, 'params.title')}</h2>
        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          {t(locale, 'params.sub')}
        </span>
      </div>

      <div className="rounded-2xl p-4" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)' }}>
        <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>{t(locale, 'params.sleepTitle', { n: sleepMinutes })}</div>
        <div className="mb-1 text-xs" style={{ color: 'var(--text-3)' }}>{t(locale, 'params.sleepDesc')}</div>
        <input
          type="range" min={1} max={30} step={1} value={sleepMinutes}
          onChange={(e) => setSleepMinutes(Number(e.target.value))}
          className="atk-range w-full" style={{ ['--fill' as string]: `${(sleepMinutes / 30) * 100}%` }}
        />
      </div>

      <div className="rounded-2xl p-4" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)' }}>
        <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
          {t(locale, 'params.lodTitle')}{lodSupported ? (lodReal ? t(locale, 'params.lodReal') : t(locale, 'params.lodPending')) : t(locale, 'params.lodLocal')}
        </div>
        <div className="mb-2 text-xs" style={{ color: 'var(--text-3)' }}>
          {lodSupported ? t(locale, 'params.lodDescReal') : t(locale, 'params.lodDescLocal')}
        </div>
        <div className="flex gap-2">
          {(['low', 'medium', 'high'] as const).map((v) => (
            <button
              key={v}
              onClick={() => writeLod(v)}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold ${lod === v ? 'btn-pill' : 'btn-ghost'}`}
            >
              {v === 'low' ? t(locale, 'params.lodLow') : v === 'medium' ? t(locale, 'params.lodMedium') : t(locale, 'params.lodHigh')}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-2xl p-4" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)' }}>
        <div>
          <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>{t(locale, 'params.angleTitle')}</div>
          <div className="text-xs" style={{ color: 'var(--text-3)' }}>{t(locale, 'params.angleDesc')}</div>
        </div>
        <Toggle on={angleSnap} onClick={() => setAngleSnap(!angleSnap)} />
      </div>

      <div className="flex items-center justify-between rounded-2xl p-4" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)' }}>
        <div>
          <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>{t(locale, 'params.lowBatt')}</div>
          <div className="text-xs" style={{ color: 'var(--text-3)' }}>{t(locale, 'params.lowBattDesc', { name: info?.name ?? t(locale, 'side.unknownDevice') })}</div>
        </div>
        <Toggle on={lowBatteryAlert} onClick={() => setLowBatteryAlert(!lowBatteryAlert)} />
      </div>
    </div>
  );
}
