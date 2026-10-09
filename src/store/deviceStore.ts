import { create } from 'zustand';
import { DEFAULT_PRESETS, canonicalProfileKey, defaultPresetsForName } from '../core/hid/devices';
import {
  requestLogitechDevice,
  getGrantedDevices,
  identify,
  mockReadDpi,
  writeDpiSmart,
  writeLightingReal,
  writeReportRateReal,
  writeRemapReal,
  writeLodReal,
  readPollingSmart,
  runDiagnostics,
  hasHidppCollections,
  type DiagStep,
  type DiagResult,
} from '../core/hid/webhid';
import type { HIDDeviceLike, SupportedDevice } from '../core/hid/types';
import { ledModeToEffectId, type LightingInfo } from '../core/hid/lighting';
import type { RemapKey } from '../core/hid/remap';
import { t, initialLocale, persistLocale, type Locale } from '../i18n';

export type Theme = 'light' | 'dark';
export type NoticeKind = 'ok' | 'err' | 'info';
export interface Notice {
  id: number;
  text: string;
  kind: NoticeKind;
}
export type HubTab =
  | 'home'
  | 'keymap'
  | 'dpi'
  | 'performance'
  | 'params'
  | 'profiles'
  | 'diag'
  | 'other';

export interface KeyBinding {
  id: string;
  label: string;
  action: string;
}

/**
 * 按键动作规范 ID（`key.*` 文案键；切换语言不丢配置、不污染导入导出）。
 * 兼容 2026-10 版存量中文字符串：loadKeymap 遇到旧中文自动映射为 ID。
 */
export const KEY_ACTION_IDS = [
  'left',
  'right',
  'middle',
  'forward',
  'back',
  'dpiCycle',
  'rateToggle',
  'media',
  'screenshot',
  'closeWindow',
  'disabled',
] as const;

export type KeyActionId = (typeof KEY_ACTION_IDS)[number];

const LEGACY_ACTION_TO_ID: Record<string, KeyActionId> = {
  '左键': 'left',
  '右键': 'right',
  '中键': 'middle',
  '前进': 'forward',
  '后退': 'back',
  'DPI 循环': 'dpiCycle',
  '回报率切换': 'rateToggle',
  '多媒体播放/暂停': 'media',
  '截图': 'screenshot',
  '关闭窗口': 'closeWindow',
  '禁用': 'disabled',
};

export function normalizeKeyAction(v: string): KeyActionId {
  if ((KEY_ACTION_IDS as readonly string[]).includes(v)) return v as KeyActionId;
  return LEGACY_ACTION_TO_ID[v] ?? 'disabled';
}

const DEFAULT_KEYS: KeyBinding[] = [
  { id: 'left', label: 'left', action: 'left' },
  { id: 'right', label: 'right', action: 'right' },
  { id: 'middle', label: 'middle', action: 'middle' },
  { id: 'forward', label: 'forward', action: 'forward' },
  { id: 'back', label: 'back', action: 'back' },
];

const KEYMAP_KEY = 'logi-web-hub:keymap';
const PARAMS_KEY = 'logi-web-hub:params';

interface LocalParams {
  sleepMinutes: number;
  lod: 'low' | 'medium' | 'high';
  angleSnap: boolean;
  lowBatteryAlert: boolean;
}

const DEFAULT_PARAMS: LocalParams = { sleepMinutes: 10, lod: 'low', angleSnap: false, lowBatteryAlert: true };

function loadParams(): LocalParams {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Partial<LocalParams>;
      return { ...DEFAULT_PARAMS, ...obj };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PARAMS;
}

function saveParams(p: LocalParams) {
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

const SLOT_IDS = ['left', 'right', 'middle', 'forward', 'back'];

function loadKeymap(): KeyBinding[] {
  try {
    const raw = localStorage.getItem(KEYMAP_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as KeyBinding[];
      if (Array.isArray(arr) && arr.length > 0 && arr.every((k) => k && SLOT_IDS.includes(k.id) && typeof k.action === 'string')) {
        return arr.map((k) => ({ id: k.id, label: k.id, action: normalizeKeyAction(k.action) }));
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_KEYS.map((k) => ({ ...k }));
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('logi-hub:theme') as Theme | null;
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

// ---- 板载多槽位：每个板载配置存自己的一套 DPI 档位 ----
// 外层 key 按机型归一，避免 G304（1 组）和 GPW（5 组）串槽。
const PROFILE_PRESETS_KEY = 'logi-web-hub:profile-presets:v1';

function deviceProfileKey(name: string | null | undefined): string {
  return canonicalProfileKey(name);
}

function loadAllProfilePresets(): Record<string, Record<number, number[]>> {
  try {
    const raw = localStorage.getItem(PROFILE_PRESETS_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, Record<number, number[]>>;
      if (obj && typeof obj === 'object') return obj;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function saveAllProfilePresets(all: Record<string, Record<number, number[]>>) {
  try {
    localStorage.setItem(PROFILE_PRESETS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** 通用自学习：实测优先，型号表兜底（新鼠标无表项也能用出正确范围/组数） */
function applyMeasuredInfo(base: SupportedDevice, result: { dpiRange?: { min: number; max: number; step: number } | null; onboard?: { count: number | null } | null; lighting?: boolean }): SupportedDevice {
  const next = { ...base };
  if (result.dpiRange) {
    next.dpiMin = result.dpiRange.min;
    next.dpiMax = result.dpiRange.max;
    if (result.dpiRange.step > 0) next.dpiStep = result.dpiRange.step;
  }
  if (result.onboard?.count != null) next.onboardProfiles = result.onboard.count;
  else if (result.onboard === null) next.onboardProfiles = 1; // 无 0x8100 即单组
  if (result.lighting) next.hasRgb = true;
  return next;
}

const REMAP_TABLE_KEY = 'logi-web-hub:remap:v1';
const LIGHTING_KEY = 'logi-web-hub:lighting:v1';

function loadRemapTable(): Record<string, Record<number, number>> {
  try {
    const raw = localStorage.getItem(REMAP_TABLE_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, Record<number, number>>;
      if (obj && typeof obj === 'object') return obj;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function saveRemapTable(all: Record<string, Record<number, number>>) {
  try {
    localStorage.setItem(REMAP_TABLE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export type LightingMode = 'steady' | 'breath' | 'off';

function loadLighting(): { mode: LightingMode; color: string } {
  try {
    const raw = localStorage.getItem(LIGHTING_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as { mode?: LightingMode; color?: string };
      if (obj && (obj.mode === 'steady' || obj.mode === 'breath' || obj.mode === 'off')) {
        return { mode: obj.mode, color: typeof obj.color === 'string' ? obj.color : '#5b8cff' };
      }
    }
  } catch {
    /* ignore */
  }
  return { mode: 'steady', color: '#5b8cff' };
}

interface HubState {
  // 主题 / 语言 / 导航
  theme: Theme;
  locale: Locale;
  tab: HubTab;
  showSettings: boolean;
  // 设备
  status: string;
  device: HIDDeviceLike | null;
  info: SupportedDevice | null;
  connected: boolean;
  busy: boolean;
  realHid: boolean;
  hidName: string | null;
  protocol: number | null;
  battery: number | null;
  batteryStatusText: string | null;
  batteryMethod: string | null;
  pollingRate: number;
  // 自检
  diagnostics: DiagStep[];
  diagRunning: boolean;
  // 自检实测的 feature 支持位（UI 按此门控，不再只信型号表）
  supportsDpi: boolean;
  supportsLighting: boolean;
  onboardRealCount: number | null;
  /** 板载模式（1=板载生效，2=主机接管；null=未知/无 0x8100） */
  onboardMode: number | null;
  /** 新灯效 0x8071 只读区数（写暂不支持，有则性能页注记） */
  rgbZoneCount: number | null;
  // DPI
  presets: number[];
  activeIndex: number;
  currentDpi: number;
  dpiColors: string[];
  // 板载 / 按键 / 参数
  profileIndex: number;
  /** 每个板载槽位的 DPI 快照（含当前槽），切换槽位时自动存取 */
  profilePresets: Record<number, number[]>;
  keymap: KeyBinding[];
  sleepMinutes: number;
  lod: 'low' | 'medium' | 'high';
  angleSnap: boolean;
  lowBatteryAlert: boolean;
  /** 全局操作反馈（写入成功/失败 toast） */
  notices: Notice[];
  // 灯效（0x8070 真写，无灯鼠标为 null/本地预览）
  lightingInfo: LightingInfo | null;
  lightingMode: LightingMode;
  lightingColor: string;
  lightingReal: boolean;
  ledViaControl: boolean;
  // 回报率（0x8060/61 真写，无 feature 回本地）
  supportedRates: number[];
  reportMethod: string | null;
  pollingReal: boolean;
  // 改键（0x1B04 真键表 + 按钮互指真写；宏仍本地）
  realButtons: RemapKey[];
  remapTable: Record<number, number>;
  remapReal: boolean;
  // LOD（0x2202 真写，无 feature 回本地）
  lodSupported: boolean;
  lodReal: boolean;
  /** 设备 LOD 真值（OpenLogi 编码 1低/2中/3高；未知为 null） */
  lodLevel: number | null;
  // actions
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  setLocale: (l: Locale) => void;
  setTab: (t: HubTab) => void;
  setShowSettings: (v: boolean) => void;
  connect: () => Promise<void>;
  autoConnect: () => Promise<void>;
  disconnect: () => Promise<void>;
  runSelfTest: () => Promise<void>;
  setPresets: (p: number[]) => void;
  setDpiColor: (i: number, color: string) => void;
  setActiveIndex: (i: number) => void;
  /** 点卡片即切换：选中该档并立即写入鼠标当前 DPI（0x2201 只能写当前值）；失败回本地并提示 */
  selectDpiSlot: (i: number) => Promise<void>;
  addDpiSlot: () => void;
  removeDpiSlot: (i: number) => void;
  applyToDevice: () => Promise<void>;
  resetDefaults: () => void;
  setPollingRate: (hz: number) => void;
  writePollingRate: (hz: number) => Promise<void>;
  setKeyAction: (id: string, action: string) => void;
  saveKeymap: () => void;
  writeKeyRemap: (cid: number, targetCid: number) => Promise<void>;
  setProfileIndex: (i: number) => void;
  setSleepMinutes: (m: number) => void;
  setLod: (v: 'low' | 'medium' | 'high') => void;
  /** 写 LOD（有 0x2202 则真写，无则本地保存） */
  writeLod: (v: 'low' | 'medium' | 'high') => Promise<void>;
  setAngleSnap: (v: boolean) => void;
  setLightingMode: (m: LightingMode) => void;
  setLightingColor: (c: string) => void;
  applyLighting: () => Promise<void>;
  notify: (text: string, kind?: NoticeKind) => void;
  dismissNotice: (id: number) => void;
  setLowBatteryAlert: (v: boolean) => void;
}

let noticeSeq = 0;

function applyThemeClass(t: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', t === 'dark');
  }
}

const FALLBACK_COLORS = ['#ff3b30', '#22e584', '#2f7cff', '#e93df2', '#ff9f0a'];

// ---- DPI 档位指示灯颜色：按设备 + 板载槽持久化，用户可改成与鼠标实物 LED 一致 ----
const DPI_COLORS_KEY = 'logi-web-hub:dpi-colors:v1';

function loadAllDpiColors(): Record<string, Record<number, string[]>> {
  try {
    const raw = localStorage.getItem(DPI_COLORS_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, Record<number, string[]>>;
      if (obj && typeof obj === 'object') return obj;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function saveAllDpiColors(all: Record<string, Record<number, string[]>>) {
  try {
    localStorage.setItem(DPI_COLORS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** 取某设备某槽的档位颜色：有自定义用自定义，缺位/超长用默认色补齐 */
function colorsFor(devKey: string, profileIdx: number, count: number): string[] {
  const saved = loadAllDpiColors()[devKey]?.[profileIdx];
  return Array.from({ length: count }, (_, i) =>
    typeof saved?.[i] === 'string' ? saved[i] : FALLBACK_COLORS[i % FALLBACK_COLORS.length],
  );
}

function persistDpiColors(devKey: string, profileIdx: number, colors: string[]) {
  const all = loadAllDpiColors();
  saveAllDpiColors({ ...all, [devKey]: { ...(all[devKey] ?? {}), [profileIdx]: colors } });
}

/**
 * DPI 预设备合并：0x2201 硬件只存“当前 DPI”，多档位是本软件的本地预设。
 * 重连/自检时不能用“出厂档+当前值”覆盖用户改过的非当前档，否则改完 DPI3 刷新就丢。
 * 策略：有本地缓存则保留缓存表，仅把设备真实 currentDpi 融进去（命中则切 active，
 * 未命中则替换最接近的一档并切到该档）；无缓存才用 fresh。
 */
function mergeDpiPresets(
  cached: number[] | undefined,
  freshPresets: number[],
  freshActive: number,
  freshCurrent: number,
  dpiList: number[] | null,
): { presets: number[]; activeIndex: number; currentDpi: number } {
  if (!cached || cached.length === 0) {
    return { presets: [...freshPresets], activeIndex: freshActive, currentDpi: freshCurrent };
  }
  const inList = (v: number) => !dpiList || dpiList.length === 0 || dpiList.includes(v);
  const sane = cached.filter((v) => Number.isFinite(v) && v > 0 && inList(v));
  const base = sane.length > 0 ? sane : [...freshPresets];
  if (freshCurrent > 0 && inList(freshCurrent)) {
    const hit = base.indexOf(freshCurrent);
    if (hit >= 0) return { presets: base, activeIndex: hit, currentDpi: freshCurrent };
    let best = 0;
    let bestDiff = Infinity;
    base.forEach((p, i) => {
      const d = Math.abs(p - freshCurrent);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    });
    const next = [...base];
    next[best] = freshCurrent;
    return { presets: next, activeIndex: best, currentDpi: freshCurrent };
  }
  const safeActive = Math.max(0, Math.min(freshActive, base.length - 1));
  return { presets: base, activeIndex: safeActive, currentDpi: base[safeActive] ?? freshCurrent };
}

/** 自检 LOD 结果落状态：有 0x2202+LOD 能力则记支持位，真值同步到本地档（设备为准） */
function lodStateFromResult(result: { extLod?: { hasLOD: boolean; lod: number | null } | null }, fallbackLod: 'low' | 'medium' | 'high') {
  const level = result.extLod?.lod ?? null;
  const synced = level === 1 ? 'low' : level === 2 ? 'medium' : level === 3 ? 'high' : fallbackLod;
  return {
    lodSupported: !!result.extLod?.hasLOD,
    lodReal: level != null,
    lodLevel: level,
    lod: synced as 'low' | 'medium' | 'high',
  };
}
/** LOD 档名（1mm/2mm 为 G Hub 常用标注，实际高度因传感器而异） */
function lodName(v: 'low' | 'medium' | 'high', locale: Locale = 'zh'): string {
  return t(locale, v === 'low' ? 'store.lodLow' : v === 'medium' ? 'store.lodMedium' : 'store.lodHigh');
}

/**
 * 全局状态：HID 会话只放引用，渲染只订阅 presets/activeIndex/currentDpi，
 * 避免 HID 轮询进渲染循环卡住 shader。
 */
export const useHub = create<HubState>((set, get) => {
  const t0 = initialTheme();
  const l0 = initialLocale();
  if (typeof window !== 'undefined') {
    applyThemeClass(t0);
    persistLocale(l0);
  }

  /** 诊断结果落到全局状态（DPI 预设 / 电量 / 识别名 / 通道 / feature 支持位） */
  const applyResult = (result: DiagResult) => {
    if (result.dpi) {
      const devKey = deviceProfileKey(result.hidName ?? get().info?.name);
      const profIdx = get().profileIndex;
      // 自检不丢本地档：用缓存表 + 设备 current 合并，并回写缓存
      const allCache = loadAllProfilePresets();
      const cached = allCache[devKey]?.[profIdx] ?? get().profilePresets[profIdx];
      const merged = mergeDpiPresets(cached, result.dpi.presets, result.dpi.activeIndex, result.dpi.currentDpi, result.dpiList);
      const colors = colorsFor(devKey, profIdx, merged.presets.length);
      saveAllProfilePresets({ ...allCache, [devKey]: { ...(allCache[devKey] ?? {}), [profIdx]: [...merged.presets] } });
      persistDpiColors(devKey, profIdx, colors);
      set({
        presets: merged.presets,
        activeIndex: merged.activeIndex,
        currentDpi: merged.currentDpi,
        dpiColors: colors,
        profilePresets: { ...get().profilePresets, [profIdx]: [...merged.presets] },
      });
    }
    set((s) => {
      // 真键表 + 本地保存的映射合并显示（复施在 finishConnect 做，自检不写设备）
      const savedMap = loadRemapTable()[deviceProfileKey(result.hidName ?? s.info?.name)] ?? {};
      const realButtons = (result.remap?.keys ?? []).map((k) => ({ ...k, mappedTo: savedMap[k.cid] ?? k.mappedTo }));
      return {
        battery: result.battery,
        batteryStatusText: result.batteryStatusText,
        batteryMethod: result.batteryMethod,
        hidName: result.hidName,
        protocol: result.protocol,
        realHid: result.reportId !== null && (result.dpi !== null || result.battery !== null),
        supportsDpi: result.supportsDpi,
        supportsLighting: result.lighting || s.info?.hasRgb || false,
        onboardRealCount: result.onboard?.count ?? null,
        onboardMode: result.onboardMode,
        rgbZoneCount: result.rgbInfo ? result.rgbInfo.zones.length : null,
        info: s.info ? applyMeasuredInfo(s.info, result) : s.info,
        lightingInfo: result.lightingInfo,
        // 自检同样刷新灯效读数（与 finishConnect 同逻辑：有 zoneEffect 用真机，否则保留用户预览）
        lightingMode: result.zoneEffect && result.lightingInfo
          ? (result.zoneEffect.effectId === 0x0a ? 'breath' : result.zoneEffect.effectId === 0x00 ? 'off' : 'steady')
          : s.lightingMode,
        lightingColor: result.zoneEffect?.color != null
          ? `#${result.zoneEffect.color.toString(16).padStart(6, '0')}`
          : s.lightingColor,
        lightingReal: false,
        ledViaControl: false,
        supportedRates: result.reportRate?.supportedHz ?? [],
        reportMethod: result.reportRate?.method ?? null,
        pollingRate: result.reportRate?.currentHz ?? s.pollingRate,
        pollingReal: result.reportRate != null,
        realButtons,
        remapTable: savedMap,
        remapReal: realButtons.length > 0,
        ...lodStateFromResult(result, s.lod),
      };
    });
  };

  /** 授权完成后的统一连接流程：跑诊断 → 识别 → 落状态 */
  const finishConnect = async (candidates: HIDDeviceLike[], statusMsg: string) => {
    const polling = await readPollingSmart();
    set({ connected: true, pollingRate: polling, tab: 'diag', status: statusMsg });
    const result = await runDiagnostics(candidates, (step) =>
      set((s) => ({ diagnostics: [...s.diagnostics, step] })),
    get().locale);
    const activeDev = result.activeDev ?? candidates[0];
    const baseInfo = identify(activeDev, result.hidName ?? undefined, result.fw);
    const info = applyMeasuredInfo(baseInfo, result);
    const measured = result.dpiRange ? t(get().locale, 'store.measured', { min: result.dpiRange.min, max: result.dpiRange.max, step: result.dpiRange.step }) : '';
    const fallback = defaultPresetsForName(result.hidName ?? info?.name) ?? [400, 800, 1600, 3200];
    const dpi = result.dpi ?? (await mockReadDpi(info?.name ?? 'unknown', fallback));
    const real = result.reportId !== null && (result.dpi !== null || result.battery !== null);
    const profileCount = info?.onboardProfiles ?? 1;
    const prevIndex = get().profileIndex;
    const safeProfileIndex = prevIndex >= 0 && prevIndex < profileCount ? prevIndex : 0;
    const devKey = deviceProfileKey(result.hidName ?? info?.name);
    const all = loadAllProfilePresets();
    const cached = all[devKey] ?? {};
    // 硬件只存当前 DPI：当前槽用缓存表+设备 current 合并，其余槽保留缓存（无缓存才用 fresh）
    const merged = mergeDpiPresets(cached[safeProfileIndex], dpi.presets, dpi.activeIndex, dpi.currentDpi, result.dpiList);
    const colors = colorsFor(devKey, safeProfileIndex, merged.presets.length);
    const nextCache: Record<number, number[]> = { ...cached, [safeProfileIndex]: [...merged.presets] };
    for (let i = 0; i < profileCount; i++) {
      if (!nextCache[i] || !Array.isArray(nextCache[i]) || nextCache[i].length === 0) {
        nextCache[i] = [...merged.presets];
      }
    }
    saveAllProfilePresets({ ...all, [devKey]: nextCache });
    // 灯效/回报率/按键实测落状态
    const savedRemap = loadRemapTable()[devKey] ?? {};
    const realButtons = (result.remap?.keys ?? []).map((k) => ({ ...k, mappedTo: savedRemap[k.cid] ?? k.mappedTo }));
    const savedLighting = loadLighting();
    set({
      device: activeDev,
      info,
      hidName: result.hidName,
      protocol: result.protocol,
      presets: [...merged.presets],
      activeIndex: merged.activeIndex,
      currentDpi: merged.currentDpi,
      dpiColors: colors,
      profileIndex: safeProfileIndex,
      profilePresets: nextCache,
      battery: result.battery,
      batteryStatusText: result.batteryStatusText,
      batteryMethod: result.batteryMethod,
      realHid: real,
      busy: false,
      diagRunning: false,
      supportsDpi: result.supportsDpi,
      supportsLighting: result.lighting || info?.hasRgb || false,
      onboardRealCount: result.onboard?.count ?? null,
      onboardMode: result.onboardMode,
      rgbZoneCount: result.rgbInfo ? result.rgbInfo.zones.length : null,
      lightingInfo: result.lightingInfo,
      lightingMode: result.zoneEffect && result.lightingInfo
        ? (result.zoneEffect.effectId === 0x0a ? 'breath' : result.zoneEffect.effectId === 0x00 ? 'off' : 'steady')
        : savedLighting.mode,
      lightingColor: result.zoneEffect?.color != null
        ? `#${result.zoneEffect.color.toString(16).padStart(6, '0')}`
        : savedLighting.color,
      lightingReal: false,
      ledViaControl: false,
      supportedRates: result.reportRate?.supportedHz ?? [],
      reportMethod: result.reportRate?.method ?? null,
      pollingRate: result.reportRate?.currentHz ?? get().pollingRate,
      pollingReal: result.reportRate != null,
      realButtons,
      remapTable: savedRemap,
      remapReal: realButtons.length > 0,
      ...lodStateFromResult(result, get().lod),
      status: real
        ? t(get().locale, 'store.finishConnected', {
          name: info?.name ?? t(get().locale, 'store.deviceFallback'),
          proto: result.protocol ?? '?',
          batt: result.battery != null ? t(get().locale, 'store.battValue', { v: result.battery }) : t(get().locale, 'store.battUnknown'),
          dpi: result.dpi ? t(get().locale, 'store.dpiValue', { v: result.dpi.currentDpi }) : t(get().locale, 'store.dpiUnknown'),
          measured,
          n: profileCount,
          real: result.onboard?.count != null ? t(get().locale, 'store.boardReal') : '',
          cur: safeProfileIndex + 1,
        })
        : t(get().locale, 'store.finishNoChannel'),
    });
    // 临时映射重启会丢：连接成功后自动复施上次保存的映射（Solaar 开机规则同款）
    if (real && Object.keys(savedRemap).length > 0 && realButtons.length > 0) {
      const known = realButtons.map((k) => k.cid);
      let ok = 0;
      for (const [cidStr, target] of Object.entries(savedRemap)) {
        const cid = Number(cidStr);
        if (!known.includes(cid) || !known.includes(target) || target === cid) continue;
        try {
          await writeRemapReal(activeDev, cid, target, known);
          ok++;
        } catch (e) {
          console.warn('[hid] 复施改键失败：', e);
        }
      }
      if (ok > 0) set({ status: get().status + t(get().locale, 'store.remapRestored', { n: ok }) });
    }
  };

  return {
    theme: t0,
    locale: l0,
    tab: 'home',
    showSettings: false,
    status: t(l0, 'store.statusInit'),
    device: null,
    info: null,
    connected: false,
    busy: false,
    realHid: false,
    hidName: null,
    protocol: null,
    battery: null,
    batteryStatusText: null,
    batteryMethod: null,
    pollingRate: 1000,
    diagnostics: [],
    diagRunning: false,
    supportsDpi: true,
    supportsLighting: false,
    onboardRealCount: null,
    onboardMode: null,
    rgbZoneCount: null,
    presets: DEFAULT_PRESETS['G304 / G305 Lightspeed'],
    activeIndex: 1,
    currentDpi: 800,
    dpiColors: FALLBACK_COLORS.slice(0, 4),
    profileIndex: 0,
    profilePresets: { 0: [...DEFAULT_PRESETS['G304 / G305 Lightspeed']] },
    keymap: loadKeymap(),
    ...loadParams(),
    notices: [],
    lightingInfo: null,
    lightingMode: loadLighting().mode,
    lightingColor: loadLighting().color,
    lightingReal: false,
    ledViaControl: false,
    supportedRates: [],
    reportMethod: null,
    pollingReal: false,
    realButtons: [],
    remapTable: {},
    remapReal: false,
    lodSupported: false,
    lodReal: false,
    lodLevel: null,

    toggleTheme: () => {
      const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('logi-hub:theme', next);
      } catch {
        /* ignore */
      }
      applyThemeClass(next);
      set({ theme: next });
    },
    setTheme: (theme) => {
      try {
        localStorage.setItem('logi-hub:theme', theme);
      } catch {
        /* ignore */
      }
      applyThemeClass(theme);
      set({ theme });
    },
    setTab: (tab) => set({ tab }),
    setShowSettings: (v) => set({ showSettings: v }),
    setLocale: (locale) => {
      persistLocale(locale);
      set({ locale });
    },

    /** 单一连接入口：授权框只列罗技 HID++ 接口（usagePage 0xff00 过滤，接收器也只有一个条目） */
    connect: async () => {
      const locale = get().locale;
      set({ busy: true, diagRunning: true, diagnostics: [], status: t(locale, 'store.statusAuth') });
      try {
        const dev = await requestLogitechDevice(locale);
        if (!dev) {
          set({ busy: false, diagRunning: false, status: t(get().locale, 'store.statusAuthCancel') });
          return;
        }
        if (!dev.opened) await dev.open();
        await finishConnect([dev], t(get().locale, 'store.statusConnecting'));
      } catch (e) {
        set({ busy: false, diagRunning: false, status: t(get().locale, 'store.statusConnectFail', { msg: (e as Error).message }) });
      }
    },

    /** 页面加载时对已授权设备静默自动连接（免再点授权框） */
    autoConnect: async () => {
      const s = get();
      if (s.connected || s.busy) return;
      set({ busy: true }); // 同步占位，防 StrictMode 双调用竞态
      try {
        const granted = await getGrantedDevices();
        const hidppDevs = granted.filter(hasHidppCollections);
        if (!hidppDevs.length) {
          set({ busy: false });
          return;
        }
        set({ diagRunning: true, diagnostics: [], status: t(get().locale, 'store.statusAuto') });
        await finishConnect(hidppDevs, t(get().locale, 'store.statusAutoIng'));
      } catch {
        set({ busy: false, diagRunning: false });
      }
    },

    disconnect: async () => {
      const { device } = get();
      try {
        await device?.close();
      } catch {
        /* ignore */
      }
      set({
        device: null,
        info: null,
        connected: false,
        realHid: false,
        hidName: null,
        protocol: null,
        battery: null,
        batteryStatusText: null,
        batteryMethod: null,
        supportsDpi: true,
        supportsLighting: false,
        onboardRealCount: null,
        onboardMode: null,
        rgbZoneCount: null,
        lightingInfo: null,
        lightingMode: loadLighting().mode,
        lightingColor: loadLighting().color,
        lightingReal: false,
        ledViaControl: false,
        supportedRates: [],
        reportMethod: null,
        pollingReal: false,
        realButtons: [],
        remapTable: {},
        remapReal: false,
        lodSupported: false,
        lodReal: false,
        lodLevel: null,
        diagnostics: [],
        tab: 'home',
        status: t(get().locale, 'store.statusDisconnected'),
      });
    },

    runSelfTest: async () => {
      set({ diagRunning: true, diagnostics: [] });
      try {
        let candidates: HIDDeviceLike[] = [];
        try {
          candidates = await getGrantedDevices();
        } catch {
          /* ignore */
        }
        const result = await runDiagnostics(candidates, (step) =>
          set((s) => ({ diagnostics: [...s.diagnostics, step] })),
        get().locale);
        if (result.activeDev) {
          const base = identify(result.activeDev, result.hidName ?? undefined, result.fw);
          set({ device: result.activeDev, info: applyMeasuredInfo(base, result) });
        }
        applyResult(result);
        set({
          diagRunning: false,
          status:
            result.battery != null
              ? t(get().locale, 'store.statusSelfDone', {
                batt: t(get().locale, 'store.selfBatt', {
                  v: result.battery,
                  dev: result.hidName ? t(get().locale, 'store.selfBattDev', { dev: result.hidName }) : '',
                }),
                dpi: result.dpi ? result.dpi.currentDpi : t(get().locale, 'store.selfDpiNone'),
              })
              : t(get().locale, 'store.statusSelfEmpty'),
        });
      } catch (e) {
        set({ diagRunning: false, status: t(get().locale, 'store.statusSelfErr', { msg: (e as Error).message }) });
      }
    },

    setPresets: (presets) => {
      const { activeIndex, profileIndex, profilePresets, info, hidName, dpiColors } = get();
      const safeIndex = Math.min(activeIndex, presets.length - 1);
      // 保留用户自定义的档位颜色（新增档补默认色），不要每次重置
      const colors = presets.map((_, i) => dpiColors[i] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]);
      const nextCache = { ...profilePresets, [profileIndex]: [...presets] };
      const devKey = deviceProfileKey(hidName ?? info?.name);
      saveAllProfilePresets({ ...loadAllProfilePresets(), [devKey]: nextCache });
      persistDpiColors(devKey, profileIndex, colors);
      set({ presets, dpiColors: colors, activeIndex: safeIndex, currentDpi: presets[safeIndex], profilePresets: nextCache });
    },
    setDpiColor: (index, color) => {
      const { dpiColors, profileIndex, info, hidName } = get();
      if (index < 0 || index >= dpiColors.length) return;
      const colors = dpiColors.map((c, i) => (i === index ? color : c));
      persistDpiColors(deviceProfileKey(hidName ?? info?.name), profileIndex, colors);
      set({ dpiColors: colors });
    },
    setActiveIndex: (activeIndex) => {
      const { presets } = get();
      if (activeIndex < 0 || activeIndex >= presets.length) return;
      set({ activeIndex, currentDpi: presets[activeIndex] });
    },
    selectDpiSlot: async (i) => {
      const { presets, activeIndex, device, realHid, busy } = get();
      if (i < 0 || i >= presets.length || busy) return;
      if (i === activeIndex) return;
      const target = presets[i];
      // 本地先切（缓存同步，保证刷新不丢），再真写
      const { profileIndex, profilePresets, info, hidName } = get();
      const nextCache = { ...profilePresets, [profileIndex]: [...presets] };
      const devKey = deviceProfileKey(hidName ?? info?.name);
      saveAllProfilePresets({ ...loadAllProfilePresets(), [devKey]: nextCache });
      set({ activeIndex: i, currentDpi: target, profilePresets: nextCache, busy: true, status: realHid ? t(get().locale, 'store.statusSelectDpi', { v: target }) : t(get().locale, 'store.statusSelectDpiLocal') });
      const dpi = await writeDpiSmart(device, presets, i);
      set({
        busy: false,
        currentDpi: dpi.currentDpi,
        status: dpi.__real
          ? t(get().locale, 'store.statusSelectDpiDone', { v: dpi.currentDpi, i: i + 1, n: presets.length })
          : t(get().locale, 'store.statusSelectDpiLocalDone'),
      });
      get().notify(
        dpi.__real ? t(get().locale, 'store.notifySelectDpiDone', { v: dpi.currentDpi }) : t(get().locale, 'store.notifySelectDpiLocal'),
        dpi.__real ? 'ok' : 'info',
      );
    },
    addDpiSlot: () => {
      const { presets, info } = get();
      const max = info?.dpiSlots ?? 5;
      if (presets.length >= max) return;
      const next = [...presets, presets[presets.length - 1] ?? 800];
      get().setPresets(next);
    },
    removeDpiSlot: (i) => {
      const { presets, activeIndex, profileIndex, profilePresets, info, hidName, dpiColors } = get();
      if (presets.length <= 1) return;
      const next = presets.filter((_, idx) => idx !== i);
      const colors = dpiColors.filter((_, idx) => idx !== i);
      const safe = activeIndex >= next.length ? next.length - 1 : activeIndex;
      const nextCache = { ...profilePresets, [profileIndex]: [...next] };
      const devKey = deviceProfileKey(hidName ?? info?.name);
      saveAllProfilePresets({ ...loadAllProfilePresets(), [devKey]: nextCache });
      persistDpiColors(devKey, profileIndex, colors);
      set({ presets: next, dpiColors: colors, activeIndex: safe, currentDpi: next[safe], profilePresets: nextCache });
    },
    applyToDevice: async () => {
      const { presets, activeIndex, device, realHid, profileIndex, info } = get();
      const total = info?.onboardProfiles ?? 1;
      const target = presets[activeIndex] ?? presets[0];
      set({ busy: true, status: realHid ? t(get().locale, 'store.statusDpiWriting', { slot: profileIndex + 1, total, dpi: target }) : t(get().locale, 'store.statusDpiSaving') });
      const dpi = await writeDpiSmart(device, presets, activeIndex);
      set({
        busy: false,
        currentDpi: dpi.currentDpi,
        status: dpi.__real
          ? t(get().locale, 'store.statusDpiDone', { v: dpi.currentDpi, slot: profileIndex + 1, total })
          : t(get().locale, 'store.statusDpiLocal'),
      });
      get().notify(
        dpi.__real ? t(get().locale, 'store.notifyDpiDone', { v: dpi.currentDpi }) : t(get().locale, 'store.notifyDpiLocal'),
        dpi.__real ? 'ok' : 'info',
      );
    },
    resetDefaults: () => {
      const { info, hidName } = get();
      const fallback = defaultPresetsForName(hidName ?? info?.name) ?? (info && DEFAULT_PRESETS[info.name]) ?? [400, 800, 1600, 3200];
      get().setPresets([...fallback]);
      set({ pollingRate: 1000, status: t(get().locale, 'store.statusResetDefaults') });
      get().notify(t(get().locale, 'store.notifyResetDefaults'), 'info');
    },
    setPollingRate: (pollingRate) => set({ pollingRate }),
    writePollingRate: async (hz) => {
      const { device, realHid, reportMethod, supportedRates, onboardMode } = get();
      if (supportedRates.length > 0 && !supportedRates.includes(hz)) {
        set({ status: t(get().locale, 'store.statusRateReject', { list: supportedRates.join('/'), hz }) });
        return;
      }
      set({ busy: true, status: realHid ? t(get().locale, 'store.statusRateWriting', { hz }) : t(get().locale, 'store.statusRateSaving') });
      try {
        const r = await writeReportRateReal(device, hz, reportMethod ?? undefined);
        try {
          localStorage.setItem('logi-web-hub:polling', String(hz));
        } catch {
          /* ignore */
        }
        if (r.switchedHost) set({ onboardMode: 0x02 });
        set({
          busy: false,
          pollingRate: hz,
          pollingReal: true,
          status: r.switchedHost
            ? t(get().locale, 'store.statusRateDoneHost', { hz })
            : t(get().locale, 'store.statusRateDone', { hz }),
        });
        get().notify(r.switchedHost ? t(get().locale, 'store.notifyRateDoneHost', { hz }) : t(get().locale, 'store.notifyRateDone', { hz }), 'ok');
      } catch (e) {
        const msg = (e as Error).message;
        try {
          localStorage.setItem('logi-web-hub:polling', String(hz));
        } catch {
          /* ignore */
        }
        const boardHint = onboardMode === 0x01 ? t(get().locale, 'store.rateBoardHint') : '';
        set({ busy: false, pollingRate: hz, pollingReal: false, status: t(get().locale, 'store.statusRateFail', { msg, hint: boardHint }) });
        get().notify(t(get().locale, 'store.notifyRateFail', { hz, msg }), 'err');
      }
    },
    setKeyAction: (id, action) =>
      set((s) => ({ keymap: s.keymap.map((k) => (k.id === id ? { ...k, action } : k)) })),
    saveKeymap: () => {
      try {
        localStorage.setItem(KEYMAP_KEY, JSON.stringify(get().keymap));
      } catch {
        /* ignore */
      }
      set({ status: t(get().locale, 'store.statusKeysSaved') });
      get().notify(t(get().locale, 'store.notifyKeysSaved'), 'ok');
    },
    writeKeyRemap: async (cid, targetCid) => {
      const { device, realHid, realButtons, info, hidName, remapTable } = get();
      const known = realButtons.map((k) => k.cid);
      set({ busy: true, status: t(get().locale, 'store.statusRemapWriting') });
      try {
        await writeRemapReal(device, cid, targetCid, known);
        const devKey = deviceProfileKey(hidName ?? info?.name);
        const next = { ...remapTable, [cid]: targetCid };
        saveRemapTable({ ...loadRemapTable(), [devKey]: next });
        set((s) => ({
          busy: false,
          remapTable: next,
          remapReal: true,
          realButtons: s.realButtons.map((k) => (k.cid === cid ? { ...k, mappedTo: targetCid } : k)),
          status: realHid
            ? t(get().locale, 'store.statusRemapDone')
            : t(get().locale, 'store.statusRemapLocal'),
        }));
        get().notify(realHid ? t(get().locale, 'store.notifyRemapDone') : t(get().locale, 'store.notifyRemapLocal'), 'ok');
      } catch (e) {
        set({ busy: false, status: t(get().locale, 'store.statusRemapFail', { msg: (e as Error).message }) });
        get().notify(t(get().locale, 'store.notifyRemapFail', { msg: (e as Error).message }), 'err');
      }
    },
    setProfileIndex: (next) => {
      const { profileIndex: prev, presets, profilePresets, info, hidName, activeIndex } = get();
      const total = info?.onboardProfiles ?? 1;
      const clamped = Math.max(0, Math.min(next, total - 1));
      if (clamped === prev) return;
      const savedCache = { ...profilePresets, [prev]: [...presets] };
      const loaded = savedCache[clamped] && savedCache[clamped].length > 0 ? [...savedCache[clamped]] : [...presets];
      const merged = { ...savedCache, [clamped]: [...loaded] };
      const devKey = deviceProfileKey(hidName ?? info?.name);
      saveAllProfilePresets({ ...loadAllProfilePresets(), [devKey]: merged });
      const colors = colorsFor(devKey, clamped, loaded.length);
      const safeActive = Math.max(Math.min(activeIndex, loaded.length - 1), 0);
      set({
        profileIndex: clamped,
        presets: loaded,
        profilePresets: merged,
        dpiColors: colors,
        activeIndex: safeActive,
        currentDpi: loaded[safeActive],
        status: t(get().locale, 'store.statusProfileSwitch', { cur: clamped + 1, total }),
      });
    },
    setSleepMinutes: (sleepMinutes) => {
      set({ sleepMinutes });
      const { lod, angleSnap, lowBatteryAlert } = get();
      saveParams({ sleepMinutes, lod, angleSnap, lowBatteryAlert });
      get().notify(t(get().locale, 'store.notifySleep', { n: sleepMinutes }), 'ok');
    },
    setLod: (lod) => {
      set({ lod, lodReal: false });
      const { sleepMinutes, angleSnap, lowBatteryAlert } = get();
      saveParams({ sleepMinutes, lod, angleSnap, lowBatteryAlert });
      get().notify(t(get().locale, 'store.notifyLodLocal', { v: lodName(lod, get().locale) }), 'ok');
    },
    writeLod: async (v) => {
      const { device, lodSupported } = get();
      const level = v === 'low' ? 1 : v === 'medium' ? 2 : 3;
      if (!lodSupported) {
        get().setLod(v);
        return;
      }
      set({ busy: true });
      try {
        await writeLodReal(device, level as 1 | 2 | 3);
        set({ busy: false, lod: v, lodReal: true, lodLevel: level });
        const { sleepMinutes, angleSnap, lowBatteryAlert } = get();
        saveParams({ sleepMinutes, lod: v, angleSnap, lowBatteryAlert });
        set({ status: t(get().locale, 'store.statusLodDone', { v: lodName(v, get().locale) }) });
        get().notify(t(get().locale, 'store.notifyLodDone', { v: lodName(v, get().locale) }), 'ok');
      } catch (e) {
        const msg = (e as Error).message;
        set({ busy: false, lod: v, lodReal: false, status: t(get().locale, 'store.statusLodFail', { msg }) });
        const { sleepMinutes, angleSnap, lowBatteryAlert } = get();
        saveParams({ sleepMinutes, lod: v, angleSnap, lowBatteryAlert });
        get().notify(t(get().locale, 'store.notifyLodFail', { msg }), 'err');
      }
    },
    setAngleSnap: (angleSnap) => {
      set({ angleSnap });
      const { sleepMinutes, lod, lowBatteryAlert } = get();
      saveParams({ sleepMinutes, lod, angleSnap, lowBatteryAlert });
      get().notify(t(get().locale, 'store.notifyAngle', { v: t(get().locale, angleSnap ? 'store.angleOn' : 'store.angleOff') }), 'ok');
    },
    setLowBatteryAlert: (lowBatteryAlert) => {
      set({ lowBatteryAlert });
      const { sleepMinutes, lod, angleSnap } = get();
      saveParams({ sleepMinutes, lod, angleSnap, lowBatteryAlert });
      get().notify(t(get().locale, 'store.notifyLowBatt', { v: t(get().locale, lowBatteryAlert ? 'store.angleOn' : 'store.angleOff') }), 'ok');
    },
    setLightingMode: (lightingMode) => set({ lightingMode }),
    setLightingColor: (lightingColor) => set({ lightingColor }),
    applyLighting: async () => {
      const { device, realHid, lightingMode, lightingColor, lightingInfo } = get();
      const hex = lightingColor.startsWith('#') ? lightingColor.slice(1) : lightingColor;
      const color = parseInt(hex.padEnd(6, '0').slice(0, 6), 16) || 0;
      if (!lightingInfo || lightingInfo.zones.length === 0) {
        try {
          localStorage.setItem(LIGHTING_KEY, JSON.stringify({ mode: lightingMode, color: lightingColor }));
        } catch {
          /* ignore */
        }
        set({ lightingReal: false, status: t(get().locale, 'store.statusLightNoZone') });
        get().notify(t(get().locale, 'store.notifyLightNoZone'), 'info');
        return;
      }
      set({ busy: true, status: realHid ? t(get().locale, 'store.statusLightWriting') : t(get().locale, 'store.statusLightSaving') });
      try {
        const r = await writeLightingReal(device, ledModeToEffectId(lightingMode), color);
        try {
          localStorage.setItem(LIGHTING_KEY, JSON.stringify({ mode: lightingMode, color: lightingColor }));
        } catch {
          /* ignore */
        }
        set({
          busy: false,
          lightingReal: true,
          ledViaControl: r.viaControl,
          status: r.viaControl
            ? t(get().locale, 'store.statusLightDoneVia')
            : t(get().locale, 'store.statusLightDone'),
        });
        get().notify(t(get().locale, 'store.notifyLightDone'), 'ok');
      } catch (e) {
        set({ busy: false, lightingReal: false, status: t(get().locale, 'store.statusLightFail', { msg: (e as Error).message }) });
        get().notify(t(get().locale, 'store.notifyLightFail', { msg: (e as Error).message }), 'err');
      }
    },
    notify: (text, kind = 'info') => {
      const id = ++noticeSeq;
      set((s) => ({ notices: [...s.notices.slice(-3), { id, text, kind }] }));
      window.setTimeout(() => get().dismissNotice(id), 3200);
    },
    dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  };
});
