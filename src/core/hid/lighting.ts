import type { Locale } from '../../i18n';
import { FEATURE, FeatureMap, hex, type Channel } from './hidpp';

/**
 * 灯效 0x8070 COLOR_LED_EFFECTS（语义对 Solaar `hidpp20.py` LEDEffectsInfo/LEDZoneInfo/LEDZoneSetting）：
 * - f0x00 → [zoneCount, ?, capabilitiesHi, capabilitiesLo]，capabilities&1 = 可读当前
 * - 每 zone i：f0x10 [i, 0xFF, 0x00] → [?, locHi, locLo, effectCount]
 * - 每 effect j：f0x20 [zoneIdx, j, 0x00] → [zindex, eindex, idHi, idLo, capHi, capLo, periodHi, periodLo]
 * - 读当前：f0xE0 [zoneIdx] → [effectIndex, p0..p9]（Static/Breathe 的 color 在 p0..p2）
 * - 写：f0x30 [zoneIdx, effectIndex, p0..p9]
 * - 接管：f0x70 读 / f0x80 写 [1=host, 0=device]（Solaar 写 zone 前要求接管，先读后按需开）
 *
 * 效果 ID（LEDEffects 表常用子集）：0x00 关闭 / 0x01 常亮 / 0x0A 呼吸。
 * Static 参数：color@0(3B) ramp@3；Breathe：color@0(3B) period@3(2B) form@5 intensity@6，
 * 默认 period=5000、intensity=100（Solaar 表默认值）。
 */

export const LED_EFFECT = {
  Disabled: 0x00,
  Static: 0x01,
  Breathe: 0x0a,
} as const;

export const LED_ZONE_LOCATION: Record<number, string> = {
  0x00: '未知位置',
  0x01: '主灯区',
  0x02: 'Logo',
  0x03: '左侧',
  0x04: '右侧',
  0x05: '组合',
  0x06: '主灯区1',
  0x07: '主灯区2',
};

const LED_ZONE_LOCATION_EN: Record<number, string> = {
  0x00: 'unknown',
  0x01: 'primary',
  0x02: 'logo',
  0x03: 'left side',
  0x04: 'right side',
  0x05: 'combined',
  0x06: 'primary 1',
  0x07: 'primary 2',
};

/** 灯区位置名（展示层按语言取，raw 保持解析原文） */
export function ledZoneName(location: number, locale: Locale = 'zh'): string {
  const table = locale === 'en' ? LED_ZONE_LOCATION_EN : LED_ZONE_LOCATION;
  return table[location] ?? (locale === 'en' ? `zone ${location}` : `灯区${location}`);
}

export interface LedEffectRef {
  /** zone 内序号（读写 wire 用它，不是全局 ID） */
  eindex: number;
  id: number;
}

export interface LedZone {
  index: number;
  location: number;
  locationName: string;
  effects: LedEffectRef[];
}

export interface LightingInfo {
  zones: LedZone[];
  readable: boolean;
  raw: string;
}

export interface ZoneEffectState {
  zoneIndex: number;
  /** effect 全局 ID（如 0x01 常亮），未知时为原始序号 */
  effectId: number;
  color: number | null; // 0xRRGGBB
  raw: string;
}

export function ledEffectName(id: number, locale: Locale = 'zh'): string {
  if (id === LED_EFFECT.Disabled) return locale === 'en' ? 'off' : '关闭';
  if (id === LED_EFFECT.Static) return locale === 'en' ? 'steady' : '常亮';
  if (id === LED_EFFECT.Breathe) return locale === 'en' ? 'breathe' : '呼吸';
  return locale === 'en' ? `effect 0x${id.toString(16)}` : `效果0x${id.toString(16)}`;
}

function effectIdToMode(id: number): 'steady' | 'breath' | 'off' | null {
  if (id === LED_EFFECT.Static) return 'steady';
  if (id === LED_EFFECT.Breathe) return 'breath';
  if (id === LED_EFFECT.Disabled) return 'off';
  return null;
}

export function ledModeToEffectId(mode: 'steady' | 'breath' | 'off'): number {
  return mode === 'steady' ? LED_EFFECT.Static : mode === 'breath' ? LED_EFFECT.Breathe : LED_EFFECT.Disabled;
}

/** 枚举灯区与各区可用效果（防御式：单区失败不影响其它区，raw 必留） */
export async function readLightingZones(
  ch: Channel,
  feats: FeatureMap,
  trace?: (line: string) => void,
): Promise<LightingInfo | null> {
  const f = await feats.tryIndex(FEATURE.COLOR_LED_EFFECTS);
  if (!f) return null;
  const head = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x00, [], 450, ch.transport);
  const count = head[3] ?? 0;
  // 头 5B：[count, ?, ?, capsHi, capsLo]（Solaar !BHH，caps=info[3:5]→带头 head[6]/[7]）
  const capabilities = ((head[6] ?? 0) << 8) | (head[7] ?? 0);
  const readable = (capabilities & 0x1) !== 0;
  trace?.(`0x8070 灯区头：${hex(head)}（${count} 区，${readable ? '可读当前' : '不可读当前'}）`);
  const zones: LedZone[] = [];
  const safeCount = Math.max(Math.min(count, 8), 0);
  for (let i = 0; i < safeCount; i++) {
    try {
      // 功能号风格：zone 枚举 0x01 / effect 枚举 0x02（Solaar 记 0x10/0x20）
      const zi = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x01, [i, 0xff, 0x00], 450, ch.transport);
      const location = ((zi[4] ?? 0) << 8) | (zi[5] ?? 0);
      const effectCount = Math.max(Math.min(zi[6] ?? 0, 24), 0);
      const effects: LedEffectRef[] = [];
      for (let j = 0; j < effectCount; j++) {
        try {
          const ei = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x02, [i, j, 0x00], 450, ch.transport);
          const id = ((ei[5] ?? 0) << 8) | (ei[6] ?? 0);
          effects.push({ eindex: ei[4] ?? j, id });
        } catch (e) {
          trace?.(`0x8070 zone${i} effect${j} 枚举失败：${(e as Error).message}`);
        }
      }
      zones.push({ index: i, location, locationName: LED_ZONE_LOCATION[location] ?? `灯区${i}`, effects });
      trace?.(`0x8070 zone${i}：${LED_ZONE_LOCATION[location] ?? location}，${effects.length} 种效果`);
    } catch (e) {
      trace?.(`0x8070 zone${i} 读取失败：${(e as Error).message}`);
    }
  }
  return { zones, readable, raw: hex(head) };
}

/** 读某区当前效果（需 readable；返回 effectId 与 color） */
export async function readZoneEffect(
  ch: Channel,
  feats: FeatureMap,
  zone: LedZone,
): Promise<ZoneEffectState | null> {
  const f = await feats.tryIndex(FEATURE.COLOR_LED_EFFECTS);
  if (!f) return null;
  const resp = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x0e, [zone.index], 450, ch.transport);
  const eindex = resp[3] ?? 0;
  const ref = zone.effects.find((e) => e.eindex === eindex);
  const effectId = ref ? ref.id : eindex;
  const color = ((resp[4] ?? 0) << 16) | ((resp[5] ?? 0) << 8) | (resp[6] ?? 0);
  return { zoneIndex: zone.index, effectId, color, raw: hex(resp) };
}

/** 读灯效接管状态：1=host（软件接管），0=device（板载行为） */
export async function readLedControl(ch: Channel, feats: FeatureMap): Promise<number | null> {
  const f = await feats.tryIndex(FEATURE.COLOR_LED_EFFECTS);
  if (!f) return null;
  try {
    const resp = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x07, [], 450, ch.transport);
    return resp[3] ?? null;
  } catch {
    return null;
  }
}

function effectParams(effectId: number, color: number): number[] {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  if (effectId === LED_EFFECT.Breathe) {
    // color(3B) + period 5000 (2B) + form 0 + intensity 100 + 填充
    return [r, g, b, 0x13, 0x88, 0x00, 100, 0x00, 0x00, 0x00];
  }
  if (effectId === LED_EFFECT.Static) {
    // color(3B) + ramp 0 + 填充
    return [r, g, b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  }
  return new Array(10).fill(0);
}

/**
 * 写某区效果（Solaar：写前需接管；本函数先直写，失败且控制可读写时自动开接管重试一次）。
 * 返回是否经过“开接管”路径（UI 可提示用户：软件接管中，拔线/重启后板载行为恢复）。
 */
export async function writeZoneEffect(
  ch: Channel,
  feats: FeatureMap,
  zone: LedZone,
  effectId: number,
  color: number,
  trace?: (line: string) => void,
): Promise<{ viaControl: boolean }> {
  const f = await feats.index(FEATURE.COLOR_LED_EFFECTS);
  const ref = zone.effects.find((e) => e.id === effectId);
  if (!ref) throw new Error(`该灯区不支持效果 0x${effectId.toString(16)}`);
  const payload = [zone.index, ref.eindex, ...effectParams(effectId, color)];
  try {
    // 写功能号 0x03，接管开 0x08（Solaar 记 0x30/0x80）
    await ch.requester.request(ch.reportId, ch.devIdx, f, 0x03, payload, 450, ch.transport);
    trace?.(`0x8070 写 zone${zone.index}：${hex(payload)}（直写成功）`);
    return { viaControl: false };
  } catch (e) {
    trace?.(`0x8070 直写失败，试接管后重试：${(e as Error).message}`);
    await ch.requester.request(ch.reportId, ch.devIdx, f, 0x08, [0x01], 450, ch.transport);
    await ch.requester.request(ch.reportId, ch.devIdx, f, 0x03, payload, 450, ch.transport);
    trace?.(`0x8070 写 zone${zone.index}：${hex(payload)}（经接管成功）`);
    return { viaControl: true };
  }
}

export { effectIdToMode };
