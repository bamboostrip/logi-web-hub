import { matchDevice, matchByHidName, genericDevice, defaultPresetsForName } from './devices';
import { isWebHIDSupported, LOGITECH_VID, type DpiState, type HIDDeviceLike } from './types';
import { t, type Locale } from '../../i18n';
import {
  findChannel, hasHidppCollections, fmtCollections, hex, FeatureMap, readDeviceName, readFirmware,
  readBattery, readDpi, writeDpi, FEATURE, deriveDpiRange, readOnboardDesc, readOnboardMode, writeOnboardMode, onboardModeName, detectLighting,
  readLodInfo, writeLod, type LodInfo,
  type Channel, type FwInfo, type BatteryInfo, type DpiInfo, type OnboardDesc,
} from './hidpp';
import { readLightingZones, readZoneEffect, readLedControl, ledEffectName, ledZoneName, writeZoneEffect, type LightingInfo, type ZoneEffectState } from './lighting';
import { readRgbEffects, type RgbEffectsInfo } from './rgb_effects';
import { readReportRate, writeReportRate, type ReportRateInfo } from './reportrate';
import { readRemapKeys, writeRemap, type RemapInfo } from './remap';

/**
 * WebHID 连接层：真机 HID++ 优先，失败回 Mock（UI 不中断）。
 *
 * 授权入口只给一个：usagePage 0xff00 过滤后，罗技接收器在浏览器选择框里只剩一个
 * 「USB Receiver」（HID++ vendor 接口），不再出现多个同名条目让用户逐个授权。
 * 设备识别优先读 HID++ DEVICE_NAME（如 "G304 Lightspeed Wireless Gaming Mouse"），
 * 型号档案（DPI 范围/档位）按名字或 USB PID 匹配。
 */

declare global {
  interface Navigator {
    hid: {
      requestDevice(opts: {
        filters: Array<{ vendorId?: number; productId?: number; usagePage?: number; usage?: number }>;
      }): Promise<HIDDeviceLike[]>;
      getDevices(): Promise<HIDDeviceLike[]>;
    };
  }
}

export { hasHidppCollections };

export function webHIDStatus(locale: Locale = 'zh'): { ok: boolean; reason: string } {
  if (!isWebHIDSupported()) {
    return { ok: false, reason: t(locale, 'diag.noWebHid') };
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return { ok: false, reason: t(locale, 'diag.noSecure') };
  }
  return { ok: true, reason: 'WebHID OK' };
}

/**
 * 弹授权框（唯一入口）：usagePage 0xff00 过滤只列罗技 HID++ 接口。
 * 大多数罗技接收器/有线鼠标的 vendor 接口都带 0xff00 collection，一个条目即可选中。
 */
export async function requestLogitechDevice(locale: Locale = 'zh'): Promise<HIDDeviceLike | null> {
  const st = webHIDStatus(locale);
  if (!st.ok) throw new Error(st.reason);
  const devices = await navigator.hid.requestDevice({
    filters: [{ vendorId: LOGITECH_VID, usagePage: 0xff00 }],
  });
  return devices[0] ?? null;
}

/** 已授权过的设备（刷新后免再选） */
export async function getGrantedDevices(): Promise<HIDDeviceLike[]> {
  try {
    return await navigator.hid.getDevices();
  } catch {
    return [];
  }
}

/** 识别型号：HID++ 设备名 > USB PID 表 > productName 通用档案 */
export function identify(device: HIDDeviceLike, hidName?: string, fw?: FwInfo[]) {
  if (hidName) {
    const byName = matchByHidName(hidName);
    if (byName) return byName;
  }
  const modelId = fw?.find((f) => f.modelId)?.modelId;
  if (modelId) {
    const byModel = matchDevice(device.vendorId, modelId);
    if (byModel) return byModel;
  }
  return (
    matchDevice(device.vendorId, device.productId) ??
    genericDevice(device.vendorId, device.productId, hidName || device.productName)
  );
}

// ---------------------------------------------------------------------------
// 自检 harness：环境 → 设备 → 通道(ping) → 识别(名称/固件) → feature → DPI → 电量
// ---------------------------------------------------------------------------

export interface DiagStep {
  name: string;
  ok: boolean;
  detail: string;
  raw?: string;
}

export interface DiagResult {
  steps: DiagStep[];
  activeDev: HIDDeviceLike | null;
  /** 通道信息 */
  reportId: number | null;
  devIndex: number | null;
  protocol: number | null;
  features: Record<string, number | null>;
  hidName: string | null;
  fw: FwInfo[];
  dpiList: number[] | null;
  /** UI 用的 presets 状态 */
  dpi: DpiState | null;
  battery: number | null;
  batteryStatusText: string | null;
  batteryMethod: string | null;
  dpiRange: { min: number; max: number; step: number } | null;
  supportsDpi: boolean;
  onboard: OnboardDesc | null;
  lighting: boolean;
  /** 灯效灯区枚举 + 0 区当前效果（无灯鼠标为 null） */
  lightingInfo: LightingInfo | null;
  zoneEffect: ZoneEffectState | null;
  ledControl: number | null;
  /** 新灯效 0x8071（只读枚举，写暂不支持） */
  rgbInfo: RgbEffectsInfo | null;
  /** 板载模式 0x8100 f0x20（1=板载生效，2=主机接管） */
  onboardMode: number | null;
  /** 回报率支持列表 + 当前值（无 0x8060/61 为 null） */
  reportRate: ReportRateInfo | null;
  /** 真实可重编程按键表（无 0x1B04 为 null） */
  remap: RemapInfo | null;
  /** 0x2202 LOD 探测（无 0x2202 为 null；有但无 LOD 能力则 hasLOD=false） */
  extLod: LodInfo | null;
}

/** 当前胜出通道（写 DPI 等复用） */
let activeChannel: Channel | null = null;
let activeFeats: FeatureMap | null = null;

function buildDpiState(dpi: DpiInfo, fallbackPresets: number[]): DpiState {
  // 设备档位表可能很长（G304 实测 200..12000 步进 50），UI 预设取默认档 + 当前值
  let presets = [...fallbackPresets];
  const inList = (v: number) => dpi.list.length === 0 || dpi.list.includes(v);
  presets = presets.filter(inList);
  if (presets.length === 0) presets = dpi.list.length ? [dpi.list[0], dpi.current] : [fallbackPresets[0]];
  if (dpi.current > 0 && !presets.includes(dpi.current)) {
    // 找最接近的槽位替换
    let best = 0;
    let bestDiff = Infinity;
    presets.forEach((p, i) => {
      const diff = Math.abs(p - dpi.current);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    presets[best] = dpi.current;
  }
  const idx = dpi.current > 0 ? Math.max(presets.indexOf(dpi.current), 0) : 0;
  return { presets, activeIndex: idx, currentDpi: presets[idx] ?? dpi.current };
}

export async function runDiagnostics(
  devs: HIDDeviceLike | HIDDeviceLike[] | null,
  onStep?: (s: DiagStep) => void,
  locale: Locale = 'zh',
): Promise<DiagResult> {
  const list = Array.isArray(devs) ? devs : devs ? [devs] : [];
  const steps: DiagStep[] = [];
  const push = (s: DiagStep) => {
    steps.push(s);
    onStep?.(s);
  };
  const features: Record<string, number | null> = {};
  const empty: DiagResult = {
    steps, activeDev: null, reportId: null, devIndex: null, protocol: null,
    features, hidName: null, fw: [], dpiList: null, dpi: null,
    battery: null, batteryStatusText: null, batteryMethod: null,
    dpiRange: null, supportsDpi: false, onboard: null, lighting: false,
    lightingInfo: null, zoneEffect: null, ledControl: null, rgbInfo: null, onboardMode: null, reportRate: null, remap: null, extLod: null,
  };

  // 1 环境
  const st = webHIDStatus(locale);
  let granted = 0;
  try {
    granted = (await getGrantedDevices()).length;
  } catch {
    /* ignore */
  }
  push({
    name: t(locale, 'diag.stepEnv'),
    ok: st.ok,
    detail: st.ok ? t(locale, 'diag.envOk', { n: granted }) : st.reason,
  });
  if (!st.ok) return empty;

  // 2 设备
  if (list.length === 0) {
    push({ name: t(locale, 'diag.stepDesc'), ok: false, detail: t(locale, 'diag.noDevice') });
    return empty;
  }
  push({
    name: t(locale, 'diag.stepDesc'),
    ok: true,
    detail: list
      .map(
        (d) =>
          `VID ${(d.vendorId ?? 0).toString(16)} / PID ${(d.productId ?? 0).toString(16)}「${d.productName || '未知'}」collections(${(d.collections ?? []).length})：${fmtCollections(d)}`,
      )
      .join('\n'),
  });

  // 3 通道探测：ping 扫 transport × reportId × deviceIndex（带 trace 原始报文）
  const traceLines: string[] = [];
  const { channel, log } = await findChannel(list, (l) => traceLines.push(l), 400);
  if (!channel) {
    const hasStray = traceLines.some((l) => l.startsWith('~'));
    push({
      name: t(locale, 'diag.stepPing'),
      ok: false,
      detail: hasStray
        ? t(locale, 'diag.pingFailStray')
        : t(locale, 'diag.pingFailNone'),
      raw: [...log, ...traceLines].join('\n') || t(locale, 'diag.pingNone'),
    });
    activeChannel = null;
    activeFeats = null;
    return { ...empty, activeDev: list[0] ?? null };
  }
  activeChannel = channel;
  activeFeats = new FeatureMap(channel);
  const idxText = channel.devIdx === 0xff ? t(locale, 'diag.idxReceiver') : hex([channel.devIdx]);
  const transText = channel.transport === 'feature' ? t(locale, 'diag.transFeature') : t(locale, 'diag.transOutput');
  push({
    name: t(locale, 'diag.stepPing'),
    ok: true,
    detail: t(locale, 'diag.pingOk', {
      name: channel.dev.productName || t(locale, 'common.unknown'),
      trans: transText,
      report: channel.reportId.toString(16),
      idx: idxText,
      proto: channel.protocol,
    }),
    raw: [...log, ...traceLines].join('\n'),
  });

  // 4 设备识别：名称 + 固件（附本阶段 raw，便于核对回包布局）
  let hidName = '';
  let fw: FwInfo[] = [];
  const tName0 = traceLines.length;
  try {
    hidName = await readDeviceName(channel, activeFeats);
  } catch (e) {
    traceLines.push(`读名称失败：${(e as Error).message}`);
  }
  try {
    fw = await readFirmware(channel, activeFeats);
  } catch {
    /* 旧固件可能没有 */
  }
  const fwText = fw
    .map((f) => `${f.kind === 0 ? t(locale, 'diag.fwMain') : f.kind === 1 ? 'Boot' : t(locale, 'diag.fwLayer', { kind: f.kind })} ${f.name} ${f.version}${f.modelId ? `（model ${hex([(f.modelId >> 8) & 0xff, f.modelId & 0xff])}）` : ''}`)
    .join(locale === 'en' ? '; ' : '；');
  const nameRaw = traceLines.slice(tName0).join('\n') || undefined;
  push({
    name: t(locale, 'diag.stepIdent'),
    ok: !!hidName,
    detail: hidName
      ? t(locale, 'diag.identOk', { name: hidName, fw: fwText })
      : channel.version1
        ? t(locale, 'diag.identV1', { fw: fwText || t(locale, 'diag.identFwFallback') })
        : t(locale, 'diag.identFail', { fw: fwText || t(locale, 'diag.identFwFallback') }),
    raw: nameRaw,
  });

  // 5 feature 存在性
  const FIDS: Array<[string, number]> = [
    ['AdjustableDPI 0x2201', FEATURE.ADJUSTABLE_DPI],
    ['BatteryStatus 0x1000', FEATURE.BATTERY_STATUS],
    ['UnifiedBattery 0x1004', FEATURE.UNIFIED_BATTERY],
    ['DeviceName 0x0005', FEATURE.DEVICE_NAME],
    ['FwVersion 0x0003', FEATURE.DEVICE_FW_VERSION],
    ['OnboardProfiles 0x8100', FEATURE.ONBOARD_PROFILES],
    ['ColorLedEffects 0x8070', FEATURE.COLOR_LED_EFFECTS],
    ['RgbEffects 0x8071', FEATURE.RGB_EFFECTS],
    ['LedControl 0x1300', FEATURE.LED_CONTROL],
    ['BatteryVoltage 0x1001', FEATURE.BATTERY_VOLTAGE],
    ['ExtDpi 0x2202', FEATURE.EXTENDED_ADJUSTABLE_DPI],
    ['ReportRate 0x8060', FEATURE.REPORT_RATE],
    ['ExtReportRate 0x8061', FEATURE.EXTENDED_ADJUSTABLE_REPORT_RATE],
    ['AngleSnap 0x2230', FEATURE.ANGLE_SNAPPING],
    ['ReprogControls 0x1B04', FEATURE.REPROG_CONTROLS_V4],
  ];
  const presence: string[] = [];
  const tFeat0 = traceLines.length;
  for (const [label, fid] of FIDS) {
    try {
      const idx = await activeFeats.tryIndex(fid);
      features[label] = idx || null;
      presence.push(idx ? `${label}=idx${idx}` : t(locale, 'diag.featAbsent', { label }));
    } catch (e) {
      features[label] = null;
      presence.push(t(locale, 'diag.featMissing', { label, msg: (e as Error).message }));
    }
  }
  push({
    name: t(locale, 'diag.stepFeat'),
    ok: true,
    detail: channel.version1
      ? t(locale, 'diag.featV1', { p: presence.join(locale === 'en' ? '; ' : '；') })
      : presence.join(locale === 'en' ? '; ' : '；'),
    raw: traceLines.slice(tFeat0).join('\n') || undefined,
  });

  // 5b 板载描述（0x8100）+ 灯效探测：不同鼠标组数/灯效不同，实测优先于型号表
  const tOnb0 = traceLines.length;
  let onboard: OnboardDesc | null = null;
  try {
    onboard = await readOnboardDesc(channel, activeFeats, (l) => traceLines.push(l));
  } catch (e) {
    traceLines.push(`读板载描述失败：${(e as Error).message}`);
  }
  let lighting = false;
  try {
    lighting = await detectLighting(activeFeats);
  } catch {
    lighting = false;
  }
  let onboardMode: number | null = null;
  try {
    onboardMode = await readOnboardMode(channel, activeFeats);
  } catch {
    onboardMode = null;
  }
  let rgbInfo: RgbEffectsInfo | null = null;
  try {
    rgbInfo = await readRgbEffects(channel, activeFeats, (l) => traceLines.push(l));
  } catch (e) {
    traceLines.push(`读 0x8071 失败：${(e as Error).message}`);
  }
  push({
    name: t(locale, 'diag.stepBoard'),
    ok: true,
    detail: `${onboard
      ? onboard.count != null
        ? t(locale, 'diag.obCount', { n: onboard.count })
        : t(locale, 'diag.obUnparsed')
      : t(locale, 'diag.obNone')}${onboardMode != null ? t(locale, 'diag.modeIs', { m: onboardModeName(onboardMode, locale) }) : t(locale, 'diag.modeUnknown')}${lighting ? t(locale, 'diag.ledHas') : t(locale, 'diag.ledNone')}（0x8070/0x8071/0x1300）${rgbInfo && rgbInfo.zones.length > 0 ? t(locale, 'diag.rgbZones', { n: rgbInfo.zones.length }) : ''}${t(locale, 'diag.obTail')}`,
    raw: traceLines.slice(tOnb0).join('\n') || undefined,
  });

  // 6 DPI 实读
  let dpiInfo: DpiInfo | null = null;
  let dpi: DpiState | null = null;
  const tDpi0 = traceLines.length;
  try {
    dpiInfo = await readDpi(channel, activeFeats);
  } catch (e) {
    traceLines.push(`读 DPI 失败：${(e as Error).message}`);
  }
  const dpiRaw = traceLines.slice(tDpi0).join('\n') || undefined;
  if (dpiInfo && (dpiInfo.current > 0 || dpiInfo.list.length)) {
    const fallback = defaultPresetsForName(hidName) ?? [400, 800, 1600, 3200];
    dpi = buildDpiState(dpiInfo, fallback);
    push({
      name: t(locale, 'diag.stepDpi'),
      ok: true,
      detail: dpiInfo.list.length
        ? t(locale, 'diag.dpiList', {
          n: dpiInfo.list.length,
          min: dpiInfo.list[0],
          max: dpiInfo.list[dpiInfo.list.length - 1],
          step: guessStep(dpiInfo.list),
          cur: dpiInfo.current,
          def: dpiInfo.defaultDpi ? t(locale, 'diag.dpiDefault', { d: dpiInfo.defaultDpi }) : '',
        })
        : t(locale, 'diag.dpiNoList', { cur: dpiInfo.current }),
      raw: dpiRaw,
    });
  } else {
    push({
      name: t(locale, 'diag.stepDpi'),
      ok: false,
      detail: channel.version1
        ? t(locale, 'diag.dpiFailV1')
        : t(locale, 'diag.dpiFail'),
      raw: dpiRaw,
    });
  }

  // 6b 扩展 DPI / LOD（0x2202）：独立于 0x2201 探测，有 LOD 能力的鼠标参数页可真写
  const tLod0 = traceLines.length;
  let extLod: LodInfo | null = null;
  try {
    extLod = await readLodInfo(channel, activeFeats, (l) => traceLines.push(l));
  } catch (e) {
    traceLines.push(`读 0x2202 失败：${(e as Error).message}`);
  }
  push({
    name: t(locale, 'diag.stepLod'),
    ok: true,
    detail: extLod
      ? (extLod.hasLOD
        ? t(locale, 'diag.lodOk', {
          v: extLod.lod === 1 ? t(locale, 'diag.lodLow') : extLod.lod === 2 ? t(locale, 'diag.lodMedium') : extLod.lod === 3 ? t(locale, 'diag.lodHigh') : t(locale, 'common.unknown'),
        })
        : t(locale, 'diag.lodNoCap'))
      : t(locale, 'diag.lodNone'),
    raw: traceLines.slice(tLod0).join('\n') || undefined,
  });

  // 7 电量实读
  let battery: BatteryInfo | null = null;
  const tBatt0 = traceLines.length;
  try {
    battery = await readBattery(channel, activeFeats, locale);
  } catch (e) {
    traceLines.push(`读电量失败：${(e as Error).message}`);
  }
  const battRaw = traceLines.slice(tBatt0).join('\n') || undefined;
  push({
    name: t(locale, 'diag.stepBatt'),
    ok: battery !== null,
    detail: battery
      ? t(locale, 'diag.battOk', {
        level: battery.level,
        status: battery.statusText,
        next: battery.next != null ? t(locale, 'diag.battNext', { n: battery.next }) : '',
        method: battery.method,
      })
      : t(locale, 'diag.battFail'),
    raw: battRaw,
  });

  // 8 灯效灯区实读（0x8070）
  const tLed0 = traceLines.length;
  let lightingInfo: LightingInfo | null = null;
  let zoneEffect: ZoneEffectState | null = null;
  let ledControl: number | null = null;
  let lightingRaw: string | undefined;
  try {
    lightingInfo = await readLightingZones(channel, activeFeats, (l) => traceLines.push(l));
    if (lightingInfo && lightingInfo.zones.length > 0) {
      ledControl = await readLedControl(channel, activeFeats);
      if (lightingInfo.readable) {
        try {
          zoneEffect = await readZoneEffect(channel, activeFeats, lightingInfo.zones[0]);
        } catch (e) {
          traceLines.push(`读 0 区当前效果失败：${(e as Error).message}`);
        }
      }
    }
  } catch (e) {
    traceLines.push(`读灯区失败：${(e as Error).message}`);
  }
  lightingRaw = traceLines.slice(tLed0).join('\n') || undefined;
  push({
    name: t(locale, 'diag.stepLed'),
    ok: true,
    detail: lightingInfo && lightingInfo.zones.length > 0
      ? `${t(locale, 'diag.ledZones', {
        n: lightingInfo.zones.length,
        zones: lightingInfo.zones.map((z) => `${ledZoneName(z.location, locale)}(${z.effects.length}${locale === 'en' ? ' effects' : '种效果'})`).join(locale === 'en' ? ', ' : '、'),
      })}${zoneEffect ? t(locale, 'diag.ledEffect', { e: ledEffectName(zoneEffect.effectId, locale) }) : ''}${ledControl != null ? t(locale, 'diag.ledCtrl', { v: ledControl === 1 ? 'host' : 'device' }) : ''}${locale === 'en' ? '.' : '。'}`
      : t(locale, 'diag.ledEmpty'),
    raw: lightingRaw,
  });

  // 9 回报率实读（0x8060/0x8061）
  const tRate0 = traceLines.length;
  let reportRate: ReportRateInfo | null = null;
  try {
    reportRate = await readReportRate(channel, activeFeats, (l) => traceLines.push(l));
  } catch (e) {
    traceLines.push(`读回报率失败：${(e as Error).message}`);
  }
  push({
    name: t(locale, 'diag.stepRate'),
    ok: true,
    detail: reportRate
      ? t(locale, 'diag.rateOk', {
        list: reportRate.supportedHz.join('/'),
        method: reportRate.method,
        cur: reportRate.currentHz ?? t(locale, 'diag.rateUnknown'),
      })
      : t(locale, 'diag.rateNone'),
    raw: traceLines.slice(tRate0).join('\n') || undefined,
  });

  // 10 按键表实读（0x1B04）
  const tKey0 = traceLines.length;
  let remap: RemapInfo | null = null;
  try {
    remap = await readRemapKeys(channel, activeFeats, (l) => traceLines.push(l), locale);
  } catch (e) {
    traceLines.push(`读按键表失败：${(e as Error).message}`);
  }
  push({
    name: t(locale, 'diag.stepKeys'),
    ok: true,
    detail: remap && remap.keys.length > 0
      ? `${t(locale, 'diag.remapOk', {
        n: remap.keys.length,
        keys: remap.keys.map((k) => `${k.name}${k.mappedTo !== k.cid ? `→${k.mappedName}` : ''}`).join(locale === 'en' ? ', ' : '、'),
      })}${locale === 'en' ? '.' : '。'}`
      : t(locale, 'diag.remapNone'),
    raw: traceLines.slice(tKey0).join('\n') || undefined,
  });

  const lodName = extLod?.lod === 1 ? t(locale, 'diag.lodLow') : extLod?.lod === 2 ? t(locale, 'diag.lodMedium') : extLod?.lod === 3 ? t(locale, 'diag.lodHigh') : t(locale, 'common.unknown');
  push({
    name: t(locale, 'diag.stepSummary'),
    ok: dpi !== null || battery !== null,
    detail: t(locale, 'diag.summary', {
      trans: transText,
      report: channel.reportId.toString(16),
      idx: idxText,
      proto: channel.protocol,
      dev: hidName ? t(locale, 'diag.sumDev', { n: hidName }) : '',
      dpi: dpi ? t(locale, 'diag.sumDpi', { v: dpi.currentDpi }) : t(locale, 'diag.sumDpiNone'),
      batt: battery ? t(locale, 'diag.sumBatt', { v: battery.level }) : t(locale, 'diag.sumBattNone'),
      ob: onboard?.count != null ? t(locale, 'diag.sumObCount', { n: onboard.count }) : onboard ? t(locale, 'diag.sumObUnparsed') : t(locale, 'diag.sumObSingle'),
      led: lightingInfo ? t(locale, 'diag.sumLedN', { n: lightingInfo.zones.length }) : t(locale, 'diag.sumLedNone'),
      rate: reportRate ? t(locale, 'diag.sumRate', { v: reportRate.currentHz ?? '?', m: reportRate.method }) : t(locale, 'diag.sumRateLocal'),
      lod: extLod?.hasLOD ? lodName : t(locale, 'diag.sumLodLocal'),
      keys: remap ? t(locale, 'diag.sumKeysN', { n: remap.keys.length }) : t(locale, 'diag.sumKeysIn'),
    }),
  });

  const dpiRange = dpiInfo?.list?.length ? deriveDpiRange(dpiInfo.list) : null;
  const supportsDpi = !!dpiInfo && (dpiInfo.current > 0 || dpiInfo.list.length > 0);

  return {
    steps,
    activeDev: channel.dev,
    reportId: channel.reportId,
    devIndex: channel.devIdx,
    protocol: channel.protocol,
    features,
    hidName: hidName || null,
    fw,
    dpiList: dpiInfo?.list ?? null,
    dpi,
    battery: battery?.level ?? null,
    batteryStatusText: battery?.statusText ?? null,
    batteryMethod: battery?.method ?? null,
    dpiRange,
    supportsDpi,
    onboard,
    lighting,
    lightingInfo,
    zoneEffect,
    ledControl,
    rgbInfo,
    onboardMode,
    reportRate,
    remap,
    extLod,
  };
}

function guessStep(list: number[]): number {
  if (list.length < 2) return 0;
  const diffs: number[] = [];
  for (let i = 1; i < Math.min(list.length, 10); i++) diffs.push(list[i] - list[i - 1]);
  const uniq = [...new Set(diffs)];
  return uniq.length === 1 ? uniq[0] : uniq[0] ?? 0;
}

// ---------------------------------------------------------------------------
// 写 DPI（复用胜出通道；失败抛给上层回 Mock）
// ---------------------------------------------------------------------------

async function ensureChannel(dev: HIDDeviceLike | null) {
  if (activeChannel && (!dev || activeChannel.dev === dev)) return;
  const devs = dev ? [dev] : await getGrantedDevices();
  const { channel } = await findChannel(devs, () => {}, 400);
  if (!channel) throw new Error('HID++ 通道不可用（见自检页）');
  activeChannel = channel;
  activeFeats = new FeatureMap(channel);
}

async function writeDpiReal(dev: HIDDeviceLike | null, presets: number[], activeIndex: number): Promise<DpiState> {
  await ensureChannel(dev);
  const dpi = presets[activeIndex] ?? presets[0];
  await writeDpi(activeChannel as Channel, activeFeats as FeatureMap, dpi);
  return { presets, activeIndex, currentDpi: dpi };
}

// ---------------------------------------------------------------------------
// Mock（localStorage）：无硬件 / 真机失败时保证 UI 可用
// ---------------------------------------------------------------------------

const MOCK_KEY = 'logi-web-hub:mock-dpi';

function loadMockPresets(fallback: number[]): number[] {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as number[];
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export async function mockReadDpi(_deviceName: string, fallback: number[]): Promise<DpiState> {
  const presets = loadMockPresets(fallback);
  return { presets, activeIndex: 1, currentDpi: presets[1] ?? fallback[1] ?? 800 };
}

export async function mockWriteDpi(presets: number[], activeIndex: number): Promise<DpiState> {
  try {
    localStorage.setItem(MOCK_KEY, JSON.stringify(presets));
  } catch {
    /* ignore */
  }
  return { presets, activeIndex, currentDpi: presets[activeIndex] ?? presets[0] };
}

// ---------------------------------------------------------------------------
// Smart 封装
// ---------------------------------------------------------------------------

export type SmartDpi = DpiState & { __real: boolean };

export async function writeDpiSmart(
  dev: HIDDeviceLike | null,
  presets: number[],
  activeIndex: number,
): Promise<SmartDpi> {
  if (dev || activeChannel) {
    try {
      const real = await writeDpiReal(dev, presets, activeIndex);
      await mockWriteDpi(presets, activeIndex);
      return { ...real, __real: true };
    } catch (e) {
      console.warn('[hid] 真机写 DPI 失败，回退 Mock：', e);
    }
  }
  const mock = await mockWriteDpi(presets, activeIndex);
  return { ...mock, __real: false };
}

/** 灯效真写（全区同模式+同色；失败抛给上层回本地） */
export async function writeLightingReal(
  dev: HIDDeviceLike | null,
  effectId: number,
  color: number,
  trace?: (line: string) => void,
): Promise<{ viaControl: boolean }> {
  await ensureChannel(dev);
  const feats = activeFeats as FeatureMap;
  const info = await readLightingZones(activeChannel as Channel, feats, trace);
  if (!info || info.zones.length === 0) throw new Error('无灯区可写（无 0x8070）');
  let viaControl = false;
  for (const z of info.zones) {
    const r = await writeZoneEffect(activeChannel as Channel, feats, z, effectId, color, trace);
    viaControl = viaControl || r.viaControl;
  }
  return { viaControl };
}

/** 回报率真写（Solaar #1040 结论：板载生效 0x01 时设备会拒绝，先切主机接管 0x02 再写；
 * 切了模式会改变板载行为，返回值告诉 UI 做明确提示；失败抛给上层回本地） */
export async function writeReportRateReal(
  dev: HIDDeviceLike | null,
  hz: number,
  method?: string,
): Promise<{ switchedHost: boolean }> {
  await ensureChannel(dev);
  const ch = activeChannel as Channel;
  const feats = activeFeats as FeatureMap;
  let switchedHost = false;
  try {
    const mode = await readOnboardMode(ch, feats);
    if (mode === 0x01) {
      await writeOnboardMode(ch, feats, 0x02);
      switchedHost = true;
    }
  } catch {
    /* 无 0x8100 或读写失败：不挡写回报率，走原逻辑，失败信息里自带原因 */
  }
  await writeReportRate(ch, feats, hz, method);
  return { switchedHost };
}

/** LOD 真写（0x2202；失败抛给上层回本地） */
export async function writeLodReal(
  dev: HIDDeviceLike | null,
  lod: 1 | 2 | 3,
): Promise<void> {
  await ensureChannel(dev);
  await writeLod(activeChannel as Channel, activeFeats as FeatureMap, lod);
}

/** 改键真写（按钮→按钮临时映射；失败抛给上层回本地） */
export async function writeRemapReal(
  dev: HIDDeviceLike | null,
  cid: number,
  targetCid: number,
  knownCids: number[],
): Promise<void> {
  await ensureChannel(dev);
  await writeRemap(activeChannel as Channel, activeFeats as FeatureMap, cid, targetCid, knownCids);
}

export async function readPollingSmart(): Promise<number> {
  try {
    const v = Number(localStorage.getItem('logi-web-hub:polling'));
    if ([125, 250, 500, 1000].includes(v)) return v;
  } catch {
    /* ignore */
  }
  return 1000;
}

export async function savePollingMock(hz: number) {
  try {
    localStorage.setItem('logi-web-hub:polling', String(hz));
  } catch {
    /* ignore */
  }
}
