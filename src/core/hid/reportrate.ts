import { FEATURE, FeatureMap, hex, type Channel } from './hidpp';

/**
 * 回报率（Solaar `settings_templates.py` ReportRate / ExtendedReportRate）：
 * - 0x8060：f0x00 → 支持掩码（bit i = 支持 i+1 ms）；f0x10 读当前（1B = ms）；f0x20 写 [ms]
 * - 0x8061（扩展）：f0x10 → 支持掩码（2B，bit i 对 ["8ms","4ms","2ms","1ms","500us","250us","125us"]）；
 *   f0x20 读当前序号；f0x30 写 [序号]
 * UI 用 Hz（125/250/500/1000），线上传 ms（8/4/2/1）。
 * Solaar 注记：板载模式下回报率可能跟随板载配置，写后若被顶回属正常（此时以板载为准）。
 * 注意：本 request() 为 (func<<4)|swId，传功能号（0x00/0x01/0x02/0x03），Solaar 文中的 0x10/0x20/0x30 是整字节。
 */

// ms → Hz：标准 4 档 + 上游全档（3/5/6/7ms 折 Hz 显示）+ 扩展 sub-ms
export const MS_TO_HZ: Record<number, number> = {
  8: 125, 7: 143, 6: 167, 5: 200, 4: 250, 3: 333, 2: 500, 1: 1000,
  0.5: 2000, 0.25: 4000, 0.125: 8000,
};
export const HZ_TO_MS: Record<number, number> = {
  125: 8, 143: 7, 167: 6, 200: 5, 250: 4, 333: 3, 500: 2, 1000: 1,
  2000: 0.5, 4000: 0.25, 8000: 0.125,
};
// 扩展档位标签见上方注释（8ms/4ms/2ms/1ms/500us/250us/125us）
const EXTENDED_MS = [8, 4, 2, 1, 0.5, 0.25, 0.125];

export interface ReportRateInfo {
  /** 支持的回报率（Hz，已排序） */
  supportedHz: number[];
  /** 当前回报率（Hz，未知为 null） */
  currentHz: number | null;
  method: string;
  raw: string;
}

function hzFromMs(ms: number): number | null {
  return MS_TO_HZ[ms] ?? null;
}

/** 读回报率：支持列表 + 当前值（防御式，任一子步失败即降级） */
export async function readReportRate(
  ch: Channel,
  feats: FeatureMap,
  trace?: (line: string) => void,
): Promise<ReportRateInfo | null> {
  const f = await feats.tryIndex(FEATURE.REPORT_RATE);
  if (f) {
    try {
      const maskResp = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x00, [], 450, ch.transport);
      const mask = maskResp[3] ?? 0;
      const supportedHz: number[] = [];
      for (let i = 0; i < 8; i++) {
        if ((mask >> i) & 0x01) {
          const hz = hzFromMs(i + 1);
          if (hz) supportedHz.push(hz);
        }
      }
      let currentHz: number | null = null;
      try {
        const cur = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x01, [], 450, ch.transport);
        currentHz = hzFromMs(cur[3] ?? 0);
        trace?.(`0x8060 回报率：掩码${hex([mask])}→[${supportedHz.join('/')}]Hz，当前${currentHz ?? '?'}Hz`);
      } catch (e) {
        trace?.(`0x8060 读当前失败：${(e as Error).message}`);
      }
      if (supportedHz.length > 0) {
        return { supportedHz: supportedHz.sort((a, b) => a - b), currentHz, method: '0x8060', raw: hex(maskResp) };
      }
    } catch (e) {
      trace?.(`0x8060 读掩码失败：${(e as Error).message}`);
    }
  }
  // 扩展版 0x8061
  const fe = await feats.tryIndex(FEATURE.EXTENDED_ADJUSTABLE_REPORT_RATE);
  if (!fe) return null;
  try {
    const maskResp = await ch.requester.request(ch.reportId, ch.devIdx, fe, 0x01, [], 450, ch.transport);
    const flags = ((maskResp[3] ?? 0) << 8) | (maskResp[4] ?? 0);
    const supportedHz: number[] = [];
    for (let i = 0; i < 7; i++) {
      if (flags & (0x01 << i)) {
        const hz = hzFromMs(EXTENDED_MS[i]);
        if (hz) supportedHz.push(hz);
      }
    }
    let currentHz: number | null = null;
    try {
      const cur = await ch.requester.request(ch.reportId, ch.devIdx, fe, 0x02, [], 450, ch.transport);
      const idx = cur[3] ?? -1;
      if (idx >= 0 && idx < 7) currentHz = hzFromMs(EXTENDED_MS[idx]);
    } catch (e) {
      trace?.(`0x8061 读当前失败：${(e as Error).message}`);
    }
    if (supportedHz.length > 0 || currentHz != null) {
      return { supportedHz: supportedHz.sort((a, b) => a - b), currentHz, method: '0x8061', raw: hex(maskResp) };
    }
  } catch (e) {
    trace?.(`0x8061 读取失败：${(e as Error).message}`);
  }
  return null;
}

/** 写回报率（Hz → ms/index，先按读到的方法写，失败自动试另一种；都失败才抛给上层回本地） */
export async function writeReportRate(
  ch: Channel,
  feats: FeatureMap,
  hz: number,
  method?: string,
  trace?: (line: string) => void,
): Promise<void> {
  const ms = HZ_TO_MS[hz];
  if (!ms) throw new Error(`不支持的回报率 ${hz}Hz`);
  const order: Array<'std' | 'ext'> = method === '0x8061' ? ['ext', 'std'] : ['std', 'ext'];
  const errs: string[] = [];
  for (const kind of order) {
    try {
      if (kind === 'std') {
        const f = await feats.tryIndex(FEATURE.REPORT_RATE);
        if (!f) throw new Error('无 0x8060');
        await ch.requester.request(ch.reportId, ch.devIdx, f, 0x02, [ms], 450, ch.transport);
        trace?.(`0x8060 写回报率：${hz}Hz（${ms}ms）`);
        return;
      } else {
        const fe = await feats.tryIndex(FEATURE.EXTENDED_ADJUSTABLE_REPORT_RATE);
        if (!fe) throw new Error('无 0x8061');
        const idx = EXTENDED_MS.indexOf(ms);
        if (idx < 0) throw new Error(`0x8061 无 ${hz}Hz 对应序号`);
        await ch.requester.request(ch.reportId, ch.devIdx, fe, 0x03, [idx], 450, ch.transport);
        trace?.(`0x8061 写回报率：${hz}Hz（序号${idx}）`);
        return;
      }
    } catch (e) {
      // 两路都记：最终报错主路在前，避免副路“无 0x8061”掩盖真正的主路失败原因
      errs.push(`${kind === 'std' ? '0x8060' : '0x8061'}：${(e as Error).message}`);
      trace?.(`写回报率 ${kind} 失败：${(e as Error).message}，换另一种再试`);
    }
  }
  throw new Error(`回报率写入失败（${errs.join('；')}）。G304 这类鼠标板载生效时会拒绝写入，切主机接管后重试；见自检页 raw。`);
}
