import type { Locale } from '../../i18n';
import { FEATURE, FeatureMap, hex, type Channel } from './hidpp';

/**
 * 改键 0x1B04 REPROG_CONTROLS_V4（语义对 Solaar `hidpp20.py` KeysArrayV4/ReprogrammableKeyV4）：
 * - f0x00 → [keyCount]（无参）；注意本 request() 传功能号：描述 0x01 / 读映射 0x02 / 写 0x03
 *   （Solaar 记 0x10/0x20/0x30，整字节；误传整字节会被截断成功能 0）
 * - 每键 i：f0x10 [i] → [cidHi, cidLo, taskHi, taskLo, flags1, pos, group, gmask, flags2]
 * - 读当前映射：f0x20 [cidHi, cidLo] → [cid(2B), mapFlags, mappedTo(2B)]
 * - 临时映射写：f0x30 [cidHi, cidLo, bfield=0, targetHi, targetLo]
 *   （bfield=0 表示不动 flags；只换目标。Solaar `_setCidReporting` 同款，不带第 6 字节以兼容老固件）
 *
 * 特别说明（Solaar 注释原文含义）：
 * - remap 是“控件指控件”：把 A 键指向 B 键的 CID，触发的是 B 的原生任务，不是递归；
 * - 目标必须在该键 gmask 允许的组内，否则设备拒绝——本模块写前用枚举到的组关系校验；
 * - 这是临时映射（重启/重连/切板载可能丢失），本项目连接成功后自动复施上次保存的映射（同 Solaar 开机规则）；
 * - 截图/关窗口等多媒体宏不是设备原生任务，做不到线里，仍走本地（UI 会标“本地”）。
 * - 0x1C00 持久映射（Key/Mouse/Consumer 码）放下一轮，本轮只读存在性。
 *
 * CID 表为事实数据（Solaar `special_keys.py` CONTROL/Task），仅收录鼠标常用子集。
 */

/** 鼠标常用 Control ID → 中文名（Solaar special_keys.CONTROL 事实子集） */
export const MOUSE_CID_NAMES: Record<number, string> = {
  0x0050: '左键',
  0x0051: '右键',
  0x0052: '中键',
  0x0053: '后退',
  0x0056: '前进',
  0x0058: 'DPI 上升',
  0x0059: 'DPI 下降',
  0x00c3: '手势键',
  0x00c4: '顶部按键',
  0x00ed: 'DPI 循环',
  0x00fd: 'DPI 切换',
  0x00d0: '多平台手势',
  0x00d7: '虚拟手势',
};

export function cidName(cid: number, locale: Locale = 'zh'): string {
  if (locale === 'en') {
    return MOUSE_CID_NAMES_EN[cid] ?? `button 0x${cid.toString(16).padStart(4, '0')}`;
  }
  return MOUSE_CID_NAMES[cid] ?? `按键0x${cid.toString(16).padStart(4, '0')}`;
}

/** 鼠标常用 Control ID → 英文名（与 MOUSE_CID_NAMES 一一对应） */
const MOUSE_CID_NAMES_EN: Record<number, string> = {
  0x0050: 'Left click',
  0x0051: 'Right click',
  0x0052: 'Middle click',
  0x0053: 'Back',
  0x0056: 'Forward',
  0x0058: 'DPI up',
  0x0059: 'DPI down',
  0x00c3: 'Gesture button',
  0x00c4: 'Top button',
  0x00ed: 'DPI cycle',
  0x00fd: 'DPI switch',
  0x00d0: 'Multi-platform gesture',
  0x00d7: 'Virtual gesture',
};

export interface RemapKey {
  index: number;
  cid: number;
  name: string;
  taskId: number;
  flags: number;
  pos: number;
  group: number;
  gmask: number;
  /** 当前映射到的 CID（未读到时等于自身） */
  mappedTo: number;
  mappedName: string;
}

export interface RemapInfo {
  keys: RemapKey[];
  raw: string;
}

/** 枚举可重编程按键（含当前映射，单键失败不影响其它键） */
export async function readRemapKeys(
  ch: Channel,
  feats: FeatureMap,
  trace?: (line: string) => void,
  locale: Locale = 'zh',
): Promise<RemapInfo | null> {
  const f = await feats.tryIndex(FEATURE.REPROG_CONTROLS_V4);
  if (!f) return null;
  const head = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x00, [], 450, ch.transport);
  const count = Math.max(Math.min(head[3] ?? 0, 32), 0);
  trace?.(`0x1B04 按键头：${hex(head)}（${count} 键）`);
  const keys: RemapKey[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const kd = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x01, [i], 450, ch.transport);
      const cid = ((kd[3] ?? 0) << 8) | (kd[4] ?? 0);
      const taskId = ((kd[5] ?? 0) << 8) | (kd[6] ?? 0);
      const flags = (kd[7] ?? 0) | ((kd[11] ?? 0) << 8);
      const pos = kd[8] ?? 0;
      const group = kd[9] ?? 0;
      const gmask = kd[10] ?? 0;
      let mappedTo = cid;
      try {
        const mr = await ch.requester.request(
          ch.reportId, ch.devIdx, f, 0x02, [(cid >> 8) & 0xff, cid & 0xff], 450, ch.transport,
        );
        const back = ((mr[3] ?? 0) << 8) | (mr[4] ?? 0);
        if (back === cid) mappedTo = ((mr[6] ?? 0) << 8) | (mr[7] ?? 0) || cid;
      } catch {
        /* 未配置过的键读映射会报错，用自身兜底（Solaar 同款） */
      }
      keys.push({ index: i, cid, name: cidName(cid, locale), taskId, flags, pos, group, gmask, mappedTo, mappedName: cidName(mappedTo, locale) });
    } catch (e) {
      trace?.(`0x1B04 键${i} 读取失败：${(e as Error).message}`);
    }
  }
  return { keys, raw: hex(head) };
}

/**
 * 临时映射：把 cid 指向 targetCid（须是枚举到的其它键 CID；bfield=0 不动 flags）。
 * 成功返回设备回显校验结果（回显不对也算成功但记 trace，Solaar 同款宽容）。
 * 注意：当前只校验目标在键表内，组（group/gmask）关系未校验——拒绝风险由设备回错体现，见自检 raw。
 */
export async function writeRemap(
  ch: Channel,
  feats: FeatureMap,
  cid: number,
  targetCid: number,
  knownCids: number[],
  trace?: (line: string) => void,
): Promise<void> {
  const f = await feats.index(FEATURE.REPROG_CONTROLS_V4);
  if (!f) throw new Error('设备不支持 0x1B04 改键');
  if (!knownCids.includes(targetCid)) {
    throw new Error(`目标 0x${targetCid.toString(16)} 不在该鼠标键表里，设备会拒绝（先用自检读出的键表选）`);
  }
  const pkt = [(cid >> 8) & 0xff, cid & 0xff, 0x00, (targetCid >> 8) & 0xff, targetCid & 0xff];
  const ret = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x03, pkt, 450, ch.transport);
  const echoOk = ret[3] === pkt[0] && ret[4] === pkt[1] && ret[5] === pkt[2] && ret[6] === pkt[3] && ret[7] === pkt[4];
  trace?.(`0x1B04 映射 ${cidName(cid)}→${cidName(targetCid)}：${hex(pkt)}（回显${echoOk ? '一致' : '不一致但已发送：' + hex(ret)}）`);
}
