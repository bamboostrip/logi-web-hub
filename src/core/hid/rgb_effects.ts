import { FEATURE, FeatureMap, hex, type Channel } from './hidpp';

/**
 * 新灯效 0x8071 RGB_EFFECTS 枚举（只读；语义对 Solaar `hidpp20.py` RGBEffectsInfo）：
 * - 与 0x8070 互斥替代（老设备 8070，新 RGB 设备 8071，如 G502 X Plus），device.led_effects 先判 8070
 * - f0x00 params [FF FF 00] → 7B：[?, ?, count, ?, capsHi, capsLo, ?]，count=byte2，readable=caps&1
 * - zone 枚举全复用 f0x00：params [zoneIdx FF 00] → 取 info[2:5]=[locHi, locLo, effectCount]
 * - effect 枚举：params [zIdx eIdx 00] → [zindex, eindex, idHi, idLo, capHi, capLo, periodHi, periodLo]
 * - 写/接管与 8070 不同构（写 f0x10 尾缀 0x01 + 常驻接管/idle 管理），本项目不搬写，
 *   只搬枚举+可读判断以扩大机型覆盖（UI 灯效卡对 8071 设备显示“支持但暂只读”，写仍走 8070 路径，缺席则本地预览）。
 */

export interface RgbZone {
  index: number;
  location: number;
  effects: number; // 该区效果数
}

export interface RgbEffectsInfo {
  zones: RgbZone[];
  readable: boolean;
  raw: string;
}

export async function readRgbEffects(
  ch: Channel,
  feats: FeatureMap,
  trace?: (line: string) => void,
): Promise<RgbEffectsInfo | null> {
  const f = await feats.tryIndex(FEATURE.RGB_EFFECTS);
  if (!f) return null;
  try {
    const head = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x00, [0xff, 0xff, 0x00], 450, ch.transport);
    if (head.length < 10) {
      trace?.(`0x8071 头过短：${hex(head)}`);
      return null;
    }
    const count = Math.max(Math.min(head[5] ?? 0, 8), 0);
    // caps=info[5:7]→带头 head[8]/[9]（去头 byte5-6；旧版错取 head[7]/[8] 偏 1B，已修）
    const caps = ((head[8] ?? 0) << 8) | (head[9] ?? 0);
    const readable = (caps & 0x1) !== 0;
    trace?.(`0x8071 灯区头：${hex(head)}（${count} 区，${readable ? '可读' : '不可读'}）`);
    const zones: RgbZone[] = [];
    for (let i = 0; i < count; i++) {
      try {
        const zi = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x00, [i, 0xff, 0x00], 450, ch.transport);
        const location = ((zi[5] ?? 0) << 8) | (zi[6] ?? 0);
        const effects = zi[7] ?? 0;
        zones.push({ index: i, location, effects });
      } catch (e) {
        trace?.(`0x8071 zone${i} 读取失败：${(e as Error).message}`);
      }
    }
    return { zones, readable, raw: hex(head) };
  } catch (e) {
    trace?.(`0x8071 读取失败：${(e as Error).message}`);
    return null;
  }
}
