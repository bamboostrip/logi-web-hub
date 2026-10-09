import { useEffect, useState } from 'react';
import { useHub } from '../../store/deviceStore';
import { t } from '../../i18n';

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

/**
 * DPI 数值输入（小尺寸，参考 G Hub：右对齐输入框 + 上下微调）：
 * 输入过程中不校验（允许逐位输入，如 1350），失焦 / 回车时才解析并交给父级钳制取整；
 * 非法输入自动还原；Esc 放弃修改。微调按钮按步进提交。
 */
function DpiValueInput({
  value,
  accent,
  step,
  minV,
  maxV,
  locale,
  onCommit,
}: {
  value: number;
  accent: string;
  step: number;
  minV: number;
  maxV: number;
  locale: 'zh' | 'en';
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);

  // 滑杆/步进器改动时同步显示（编辑中不打扰用户输入）
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n)) {
      setText(String(value)); // 非法输入还原
      return;
    }
    onCommit(n);
  };

  const stepper =
    'grid h-3.5 w-6 place-items-center text-[8px] transition hover:opacity-70 disabled:opacity-30';

  return (
    <span className="flex items-center gap-1">
      <input
        value={text}
        inputMode="numeric"
        aria-label={t(locale, 'dpi.numAria')}
        onFocus={(e) => {
          setEditing(true);
          e.target.select();
        }}
        onChange={(e) => {
          // 只允许数字，彻底避免 '-'/'.'/'e' 等怪异中间态
          if (/^\d{0,5}$/.test(e.target.value)) setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(String(value));
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="font-dpi w-20 rounded-lg border px-2 py-1 text-right text-sm font-bold outline-none transition"
        style={{
          background: 'var(--input-bg)',
          borderColor: editing ? accent : 'var(--card-border)',
          color: 'var(--text)',
          caretColor: accent,
          boxShadow: editing ? `0 0 0 2px ${accent}55` : 'none',
        }}
        title={t(locale, 'dpi.numTitle')}
      />
      <span
        className="flex flex-col overflow-hidden rounded-md border"
        style={{ borderColor: 'var(--card-border)', background: 'var(--input-bg)', color: 'var(--text-2)' }}
      >
        <button
          title={t(locale, 'dpi.stepUp', { s: step })}
          aria-label={t(locale, 'dpi.increase')}
          disabled={value >= maxV}
          onClick={() => onCommit(value + step)}
          className={stepper}
        >
          ▲
        </button>
        <button
          title={t(locale, 'dpi.stepDown', { s: step })}
          aria-label={t(locale, 'dpi.decrease')}
          disabled={value <= minV}
          onClick={() => onCommit(value - step)}
          className={stepper}
          style={{ borderTop: '1px solid var(--card-border)' }}
        >
          ▼
        </button>
      </span>
    </span>
  );
}

/**
 * DPI设置页（G Hub 式横条卡）：
 * 整卡点击切换档位（方便），数值框 / 微调 / 滑杆 / 取色整个编辑区阻断冒泡，
 * 点中编辑区只改值不切档，避免误触。
 * 删除为数值框右侧的红色垃圾桶（悬浮露出），点后弹确认框。
 * 底部滑杆按档位色填充。
 */
export default function DpiPanel() {
  const {
    presets, activeIndex, dpiColors, info, busy,
    setPresets, selectDpiSlot, addDpiSlot, removeDpiSlot,
    applyToDevice, currentDpi,
    profileIndex, setTab, supportsDpi, connected, realHid, setDpiColor, locale,
  } = useHub();

  const max = info?.dpiMax ?? 12000;
  const min = 10;
  const dpiSlotMax = info?.dpiSlots ?? 5;
  const canAdd = presets.length < dpiSlotMax;
  const profileCount = info?.onboardProfiles ?? 1;

  // 删除确认弹窗：confirmIndex 为待删除的档位（null = 关闭）
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  useEffect(() => {
    if (confirmIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmIndex(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmIndex]);

  const updateSlot = (idx: number, val: number) => {
    const lo = info?.dpiMin ?? 100;
    const step = info?.dpiStep ?? 50;
    const v = Math.min(max, Math.max(lo, Math.round(val / step) * step));
    const next = presets.map((p, i) => (i === idx ? v : p));
    setPresets(next);
  };

  const ticks = [min, Math.round(max / 4), Math.round(max / 2), Math.round((max * 3) / 4), max];

  const confirmDpi = confirmIndex != null ? presets[confirmIndex] : undefined;
  const closeConfirm = () => setConfirmIndex(null);
  const doConfirmDelete = () => {
    if (confirmIndex != null && presets.length > 1) removeDpiSlot(confirmIndex);
    setConfirmIndex(null);
  };

  // 无 0x2201 的鼠标（如部分办公鼠固定档）：DPI 页自动隐藏，指向自检页
  if (connected && !supportsDpi) {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-4">
        <h2 className="text-[15px] font-black" style={{ color: 'var(--text)' }}>{t(locale, 'dpi.noDpiTitle')}</h2>
        <div className="mt-3 rounded-2xl p-4 text-xs leading-5" style={{ background: 'var(--bg-soft)', border: '1px solid var(--card-border)', color: 'var(--text-2)' }}>
          {t(locale, 'dpi.noDpiBody', { why: realHid ? t(locale, 'dpi.noDpiWhyReal') : t(locale, 'dpi.noDpiWhyLocal') })}
          <button onClick={() => setTab('diag')} className="ml-1 font-bold underline underline-offset-2">{t(locale, 'dpi.gotoDiag')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-in mx-auto w-full max-w-6xl px-5 py-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-black" style={{ color: 'var(--text)' }}>{t(locale, 'dpi.title')}</h2>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
            {t(locale, 'dpi.current')} <b style={{ color: 'var(--text)' }}>{currentDpi}</b> · {t(locale, 'dpi.step')} {info?.dpiStep ?? 50} · {t(locale, 'dpi.range')} {info?.dpiMin}–{max}
          </span>
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
            style={{ background: 'var(--accent-soft)', color: 'var(--text)' }}
            title={profileCount > 1
              ? t(locale, 'dpi.multiNote', { n: profileCount, cur: profileIndex + 1 })
              : t(locale, 'dpi.singleGroupBadge')}
          >
            {profileCount > 1 ? t(locale, 'dpi.localSlotBadge', { a: profileIndex + 1, b: profileCount }) : t(locale, 'dpi.singleGroupBadge')}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            {t(locale, 'dpi.slots', { a: presets.length, b: dpiSlotMax })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={applyToDevice}
            disabled={busy}
            className="btn-pill rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50"
            title={profileCount > 1
              ? t(locale, 'dpi.multiNote', { n: profileCount, cur: profileIndex + 1 })
              : t(locale, 'dpi.singleGroupBadge')}
          >
            {busy ? t(locale, 'dpi.writing') : profileCount > 1 ? t(locale, 'dpi.saveWriteSlot', { a: profileIndex + 1, b: profileCount }) : t(locale, 'dpi.saveWrite')}
          </button>
          <button
            onClick={addDpiSlot}
            disabled={!canAdd}
            className="btn-ghost rounded-lg px-3 py-1.5 text-xs disabled:opacity-40"
            title={canAdd ? t(locale, 'dpi.addSlotTip', { n: dpiSlotMax }) : t(locale, 'dpi.addSlotFull', { n: dpiSlotMax })}
          >
            {t(locale, 'dpi.addSlot')}
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
        <span>
          {profileCount > 1
            ? t(locale, 'dpi.multiNote', { n: profileCount, cur: profileIndex + 1 })
            : t(locale, 'dpi.hwNote')}
        </span>
        {profileCount > 1 && (
          <button onClick={() => setTab('profiles')} className="font-bold underline underline-offset-2 hover:opacity-80" style={{ color: 'var(--text-2)' }}>
            {t(locale, 'dpi.gotoProfiles')}
          </button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {presets.map((dpi, i) => {
          const active = i === activeIndex;
          const color = dpiColors[i] ?? '#2f7cff';
          const fill = ((dpi - min) / (max - min)) * 100;
          const single = presets.length <= 1;
          return (
            <div
              key={i}
              onClick={() => { void selectDpiSlot(i); }}
              className="group cursor-pointer rounded-2xl p-4 transition-shadow"
              style={{
                background: 'var(--bg-soft)',
                border: active ? '1.5px solid var(--text)' : '1px solid var(--card-border)',
              }}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-0 rounded-full py-1 pl-2 pr-3 text-xs font-bold" style={{ background: 'var(--input-bg)', color: 'var(--text-2)' }}>
                  <label
                    onClick={(e) => e.stopPropagation()}
                    className="relative mr-2 inline-block cursor-pointer"
                    title={t(locale, 'dpi.colorTitle')}
                  >
                    <span
                      className="inline-block h-3.5 w-3.5 rounded-full align-middle"
                      style={{ background: color, boxShadow: `0 0 8px ${color}88` }}
                    />
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setDpiColor(i, e.target.value)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      aria-label={t(locale, 'dpi.colorAria', { n: i + 1 })}
                    />
                  </label>
                  DPI {i + 1}
                  {active && (
                    <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `${color}22`, color }}>
                      {t(locale, 'dpi.currentBadge')}
                    </span>
                  )}
                </span>
              </div>

              {/* 编辑区：整块阻断冒泡，点数值/微调/滑杆只改值不切档 */}
              <div className="cursor-default" onClick={(e) => e.stopPropagation()}>
              {/* 数值行：左 DPI 标签，右小输入框 + 微调 + 删除（悬浮/当前档才露出的红色垃圾桶） */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs" style={{ color: 'var(--text-2)' }}>{t(locale, 'dpi.dpiLabel')}</span>
                <span className="flex items-center gap-1.5">
                <DpiValueInput
                  value={dpi}
                  accent={color}
                  step={info?.dpiStep ?? 50}
                  minV={info?.dpiMin ?? 100}
                  maxV={max}
                  locale={locale}
                  onCommit={(n) => updateSlot(i, n)}
                />
                {single ? (
                  <button
                    disabled
                    title={t(locale, 'dpi.delDisabled')}
                    aria-label={t(locale, 'dpi.delAria', { n: i + 1 })}
                    className="grid h-8 w-8 place-items-center rounded-lg opacity-0 transition group-hover:opacity-40 group-focus-within:opacity-40"
                    style={{ color: '#d92d20' }}
                  >
                    <TrashIcon />
                  </button>
                ) : (
                  <button
                    title={t(locale, 'dpi.delTitle', { n: i + 1, v: dpi })}
                    aria-label={t(locale, 'dpi.delAria', { n: i + 1 })}
                    onClick={(e) => { e.stopPropagation(); setConfirmIndex(i); }}
                    className={`grid h-8 w-8 place-items-center rounded-lg transition hover:bg-red-50 dark:hover:bg-red-950/40 focus-visible:opacity-100 ${
                      active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                    }`}
                    style={{ color: '#d92d20' }}
                  >
                    <TrashIcon />
                  </button>
                )}
                </span>
              </div>

              <div className="mt-3">
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={info?.dpiStep ?? 50}
                  value={dpi}
                  onChange={(e) => updateSlot(i, Number(e.target.value))}
                  className="atk-range w-full"
                  style={{ ['--fill' as string]: `${fill}%`, ['--accent' as string]: color }}
                />
                <div className="mt-1 flex justify-between text-[10px]" style={{ color: 'var(--text-3)' }}>
                  {ticks.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] leading-5" style={{ color: 'var(--text-3)' }}>
        {t(locale, 'dpi.bottomNote', { step: info?.dpiStep ?? 50 })}
      </p>

      {/* 删除确认弹窗 */}
      {confirmIndex != null && confirmDpi != null && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: 'rgba(15, 18, 28, 0.45)', backdropFilter: 'blur(2px)' }}
          onClick={closeConfirm}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={t(locale, 'dpi.delModalAria')}
            className="w-[320px] max-w-full rounded-2xl p-5"
            style={{ background: 'var(--card)', border: '1px solid var(--card-border)', boxShadow: '0 24px 64px rgba(8, 12, 24, 0.35)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[15px] font-black" style={{ color: 'var(--text)' }}>{t(locale, 'dpi.delModalTitle')}</div>
            <div className="mt-3 flex items-center gap-2.5">
              <span
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-black text-white"
                style={{ background: '#f5a623' }}
              >
                !
              </span>
              <span className="text-[13px]" style={{ color: 'var(--text-2)' }}>
                {t(locale, 'dpi.delModalText', { n: confirmIndex + 1, v: confirmDpi })}
              </span>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                autoFocus
                onClick={closeConfirm}
                className="btn-ghost rounded-lg px-4 py-1.5 text-xs"
              >
                {t(locale, 'dpi.cancel')}
              </button>
              <button
                onClick={doConfirmDelete}
                className="rounded-lg px-4 py-1.5 text-xs font-bold text-white transition hover:opacity-90"
                style={{ background: '#d92d20' }}
              >
                {t(locale, 'dpi.delModalOk')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
