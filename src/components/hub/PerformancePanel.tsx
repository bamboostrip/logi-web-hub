import { dpiToHue } from '../../shaders/glsl';
import { useHub, type LightingMode } from '../../store/deviceStore';
import { t } from '../../i18n';
import { ledZoneName } from '../../core/hid/lighting';

/** 状态徽标：已写入鼠标（绿）/ 待写入（橙）/ 仅本地（灰） */
function StateBadge({ state, locale }: { state: 'real' | 'pending' | 'local'; locale: 'zh' | 'en' }) {
  const map = {
    real: { text: t(locale, 'perf.stateReal'), bg: 'rgba(34,197,94,0.14)', color: '#16a34a', dot: '#22c55e' },
    pending: { text: t(locale, 'perf.statePending'), bg: 'rgba(245,158,11,0.14)', color: '#d97706', dot: '#f59e0b' },
    local: { text: t(locale, 'perf.stateLocal'), bg: 'var(--input-bg)', color: 'var(--text-3)', dot: 'var(--text-3)' },
  } as const;
  const s = map[state];
  return (
    <span
      className="ml-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 align-middle text-[10px] font-bold"
      style={{ background: s.bg, color: s.color }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
      {s.text}
    </span>
  );
}

function Row({ title, desc, right, badge }: { title: string; desc: string; right: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-2xl p-4"
      style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)' }}
    >
      <div className="min-w-0">
        <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
          {title}
          {badge}
        </div>
        <div className="mt-0.5 text-xs leading-5" style={{ color: 'var(--text-3)' }}>{desc}</div>
      </div>
      {right}
    </div>
  );
}

/** 性能设置：回报率 + 无线/省电 + 灯效（无灯鼠标自动隐藏，实测优先于型号表） */
export default function PerformancePanel() {
  const { pollingRate, writePollingRate, supportedRates, pollingReal, busy, battery, info, currentDpi, supportsLighting, onboardRealCount, onboardMode, reportMethod, locale } = useHub();
  // 拷贝后再排序：直接 sort 会原地变异 zustand 状态数组
  const rates = [...(supportedRates.length > 0 ? supportedRates : [125, 250, 500, 1000])].sort((a, b) => a - b);
  const showLighting = (info?.hasRgb || supportsLighting) ?? false;

  return (
    <div className="panel-in mx-auto flex w-full max-w-3xl flex-col gap-3 px-5 py-4">
      <h2 className="text-[15px] font-black" style={{ color: 'var(--text)' }}>{t(locale, 'perf.title')}</h2>
      <Row
        title={t(locale, 'perf.rateTitle', { v: pollingRate })}
        badge={
          pollingReal ? <StateBadge state="real" locale={locale} /> : supportedRates.length > 0 ? <StateBadge state="pending" locale={locale} /> : <StateBadge state="local" locale={locale} />
        }
        desc={supportedRates.length > 0
          ? t(locale, 'perf.rateDescReal', {
            list: rates.join('/'),
            method: reportMethod ?? '0x8060',
            board: onboardMode === 0x01 ? t(locale, 'perf.rateBoardHost') : t(locale, 'perf.rateBoard'),
          })
          : t(locale, 'perf.rateDescLocal')}
        right={
          <div className="flex shrink-0 gap-1.5">
            {rates.map((r) => {
              const active = pollingRate === r;
              return (
                <button
                  key={r}
                  disabled={busy}
                  onClick={() => writePollingRate(r)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${active ? 'btn-pill' : 'btn-ghost'}`}
                >
                  {r}
                </button>
              );
            })}
          </div>
        }
      />
      <Row
        title={t(locale, 'perf.batteryTitle', { v: battery ?? t(locale, 'perf.batteryUnknown') })}
        desc={(info?.hasRgb || supportsLighting) ? t(locale, 'perf.batteryRgb') : t(locale, 'perf.batteryPlain')}
        right={
          <div className="h-2.5 w-32 shrink-0 overflow-hidden rounded-full" style={{ background: 'var(--input-bg)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${battery ?? 0}%`,
                background: (battery ?? 100) <= 15 ? '#ef4444' : (battery ?? 100) <= 40 ? '#f59e0b' : '#22c55e',
              }}
            />
          </div>
        }
      />
      <Row
        title={t(locale, 'perf.wirelessTitle')}
        desc={t(locale, 'perf.wirelessDesc')}
        right={<span className="shrink-0 text-xs" style={{ color: 'var(--text-3)' }}>{t(locale, 'perf.wirelessGood')}</span>}
      />
      {showLighting ? (
        <LightingCard dpi={currentDpi} />
      ) : (
        <div className="rounded-2xl p-4 text-xs" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)', color: 'var(--text-3)' }}>
          {t(locale, 'perf.lightHidden', { extra: onboardRealCount != null ? t(locale, 'perf.lightHiddenBoard', { n: onboardRealCount }) : '' })}
        </div>
      )}
    </div>
  );
}

/** 灯效三件套：常亮 / 呼吸 / 关闭 + 取色器（0x8070 真写，点“写入灯效”进鼠标） */
function LightingCard({ dpi }: { dpi: number }) {
  const { lightingMode: mode, setLightingMode: setMode, lightingColor, setLightingColor, applyLighting, lightingInfo, lightingReal, ledViaControl, busy, rgbZoneCount, locale } = useHub();
  const color = lightingColor.startsWith('#') ? lightingColor : hslToHex(lightingColor);
  const setColor = (c: string) => setLightingColor(c);
  const canWrite = !!(lightingInfo && lightingInfo.zones.length > 0);
  const modeName = (m: LightingMode) => m === 'steady' ? t(locale, 'perf.steady') : m === 'breath' ? t(locale, 'perf.breath') : t(locale, 'perf.off');
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)' }}>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
          {t(locale, 'perf.lightTitle')}
          {lightingReal ? <StateBadge state="real" locale={locale} /> : canWrite ? <StateBadge state="pending" locale={locale} /> : <StateBadge state="local" locale={locale} />}
        </div>
        <span className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-2)' }}>
          <span
            className="inline-block h-4 w-4 rounded-full border"
            style={{ background: mode === 'off' ? '#333' : color, borderColor: 'var(--card-border)', boxShadow: mode === 'off' ? 'none' : `0 0 10px ${color}` }}
          />
          {modeName(mode)}
        </span>
      </div>
      <div className="mb-2 text-xs leading-5" style={{ color: 'var(--text-3)' }}>
        {canWrite
          ? t(locale, 'perf.lightDescReal', {
            n: lightingInfo!.zones.length,
            zones: lightingInfo!.zones.map((z) => ledZoneName(z.location, locale)).join(locale === 'en' ? ', ' : '、'),
            dpi,
            via: ledViaControl ? t(locale, 'perf.lightVia') : '',
          })
          : rgbZoneCount != null && rgbZoneCount > 0
            ? t(locale, 'perf.lightDescRgb', { n: rgbZoneCount, dpi })
            : t(locale, 'perf.lightDescNone', { dpi })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(['steady', 'breath', 'off'] as const).map((m: LightingMode) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${mode === m ? 'btn-pill' : 'btn-ghost'}`}
          >
            {modeName(m)}
          </button>
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 w-12 cursor-pointer rounded-lg border"
          style={{ borderColor: 'var(--card-border)', background: 'var(--input-bg)' }}
          title={t(locale, 'perf.pickColor')}
        />
        <button
          onClick={() => setColor(`hsl(${dpiToHue(dpi)}, 90%, 55%)`)}
          className="btn-ghost rounded-lg px-3 py-1.5 text-xs"
        >
          {t(locale, 'perf.followDpi')}
        </button>
        <button
          onClick={applyLighting}
          disabled={busy}
          className="btn-pill rounded-lg px-4 py-1.5 text-xs font-bold disabled:opacity-50"
          title={canWrite ? t(locale, 'perf.saveLightTitleReal') : t(locale, 'perf.saveLightTitleLocal')}
        >
          {busy ? t(locale, 'perf.saveLightBusy') : canWrite ? t(locale, 'perf.saveLight') : t(locale, 'perf.saveLightLocal')}
        </button>
      </div>
    </div>
  );
}

function hslToHex(hsl: string): string {
  if (hsl.startsWith('#')) return hsl;
  const m = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!m) return '#5b8cff';
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(h + 1 / 3))}${to(f(h))}${to(f(h - 1 / 3))}`;
}
