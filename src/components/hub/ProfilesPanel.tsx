import { useHub } from '../../store/deviceStore';
import { t } from '../../i18n';

/** 配置管理：按机型动态渲染 N 组板载，明确标注当前生效槽 */
export default function ProfilesPanel() {
  const { profileIndex, setProfileIndex, presets, profilePresets, pollingRate, keymap, status, info, onboardRealCount, locale } = useHub();

  const profileCount = info?.onboardProfiles ?? 1;
  const safeIndex = profileIndex >= 0 && profileIndex < profileCount ? profileIndex : 0;
  const dpiSlotMax = info?.dpiSlots ?? 5;

  const exportJson = () => {
    const data = JSON.stringify({ profileIndex: safeIndex, profileCount, presets, pollingRate, keymap }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `logi-hub-profile${safeIndex + 1}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (f: File) => {
    try {
      const obj = JSON.parse(await f.text()) as { presets?: number[] };
      if (Array.isArray(obj.presets) && obj.presets.length > 0) {
        useHub.getState().setPresets(obj.presets.slice(0, dpiSlotMax));
      }
    } catch {
      useHub.getState().notify(t(useHub.getState().locale, 'profiles.importFail'), 'err');
    }
  };

  const previewFor = (i: number) => {
    if (i === safeIndex) return presets;
    const cached = profilePresets[i];
    return cached && cached.length > 0 ? cached : presets;
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-black" style={{ color: 'var(--text)' }}>
          {t(locale, 'profiles.title')}
          <span className="ml-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--text)' }}>
            {info ? t(locale, 'profiles.badgeGroups', { name: info.name, n: profileCount }) + (onboardRealCount != null ? t(locale, 'profiles.boardReal') : t(locale, 'profiles.boardFile')) : `${t(locale, 'profiles.badgeGroupsShort', { n: profileCount })}`}
          </span>
        </h2>
        <button className="text-xs opacity-70 hover:opacity-100" style={{ color: 'var(--text-2)' }}>
          {t(locale, 'profiles.manageBtn')}
        </button>
      </div>
      <p className="mb-3 text-[11px] leading-5" style={{ color: 'var(--text-3)' }}>
        {t(locale, 'profiles.ruleNote')}<b style={{ color: 'var(--text)' }}>{t(locale, 'profiles.ruleActive', { n: safeIndex + 1 })}</b>
        {t(locale, 'profiles.ruleBody', { m: dpiSlotMax })}
      </p>
      <div className="grid gap-2">
        {Array.from({ length: profileCount }, (_, i) => {
          const active = i === safeIndex;
          const preview = previewFor(i);
          return (
            <button
              key={i}
              onClick={() => setProfileIndex(i)}
              className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left"
              style={{
                background: 'var(--bg-soft)',
                border: active ? '1.5px solid var(--pill-bg)' : '1px solid var(--card-border)',
              }}
              title={active ? t(locale, 'profiles.switchTitleActive', { n: i + 1 }) : t(locale, 'profiles.switchTitle', { n: i + 1 })}
            >
              <span className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--text)' }}>
                {t(locale, 'profiles.configName', { n: i + 1 })}
                {active ? (
                  <span className="rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white">{t(locale, 'profiles.activeBadge')}</span>
                ) : (
                  <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'var(--input-bg)', color: 'var(--text-3)' }}>
                    {t(locale, 'profiles.clickSwitch')}
                  </span>
                )}
              </span>
              <span className="truncate text-xs" style={{ color: 'var(--text-3)' }}>
                {t(locale, 'profiles.dpiPreview', { v: preview.join(' / ') })}
              </span>
            </button>
          );
        })}
      </div>
      {profileCount <= 1 && (
        <p className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
          {t(locale, 'profiles.singleNote')}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={exportJson}
          className="btn-pill rounded-lg px-4 py-2 text-xs font-bold"
          title={t(locale, 'profiles.exportTitle', { n: safeIndex + 1 })}
        >
          {t(locale, 'profiles.exportBtn', { n: safeIndex + 1 })}
        </button>
        <label
          className="cursor-pointer rounded-lg px-4 py-2 text-xs"
          style={{ background: 'var(--input-bg)', color: 'var(--text-2)' }}
          title={t(locale, 'profiles.importTitle')}
        >
          {t(locale, 'profiles.importBtn')}
          <input
            type="file" accept="application/json" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
            }}
          />
        </label>
      </div>
      <p className="mt-3 text-[11px]" style={{ color: 'var(--text-3)' }}>{status}</p>
    </div>
  );
}
