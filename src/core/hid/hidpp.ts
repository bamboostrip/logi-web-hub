import type { Locale } from '../../i18n';
import type { HIDDeviceLike } from './types';

/**
 * HID++ 协议客户端（语义参考社区实现 Solaar 的 logitech_receiver，GPLv2，仅参考语义、自己重写，
 * 详见 docs/05-solaar-migration.md §1-2；事实数据如 PID/范围另见 devices.ts 出处注）。
 *
 * 真机验证过的关键事实（046d:c53f 接收器 + G304，见 .hidpp-probe 实验记录）：
 * - 接收器自身（device index 0xFF）只说 HID++ 1.0，只在短报文 0x10 上应答；
 * - 接收器后的鼠标（device index 0x01）说 HID++ 4.2，只在长报文 0x11 上应答；
 *   所以握手必须 ping 扫「传输 × reportId × deviceIndex」组合，且：
 * - 0x8F/0xFF 错误帧代表「通道活着但语义错误」（1.0 设备对 2.0 ping 的典型反应），不是失败；
 *   注意错误帧的 swId 回显在 body[3] 而非 body[2]，匹配时必须区分（旧版根因之一）；
 * - swId（byte3 低 4 位）必须非 0，2.x 设备对 swId=0 的请求直接不应答（旧版根因）；
 * - 传输必须双试：output(sendReport) 与 feature(sendFeatureReport)，部分 Win/Chrome
 *   驱动组合下只有其一能真正到达设备；
 * - WebHID 一个 HIDDevice 覆盖整个 USB 接口（多个 collection），sendReport 按 reportId
 *   自动路由到对应 collection，inputreport 事件两种 reportId 都能收到。
 */

export const SW_ID = 0x0b; // Solaar 同款，避开 G HUB(0x0D)/OpenRGB(0x07) 等
export const REPORT_SHORT = 0x10;
export const REPORT_LONG = 0x11;
export const DEVIDX_RECEIVER = 0xff;

export const hex = (a: ArrayLike<number>) =>
  Array.from(a, (b) => (b & 0xff).toString(16).padStart(2, '0')).join(' ');

/** HID++ 2.x 错误码（Solaar Hidpp20ErrorCodes） */
const HIDPP2_ERRORS: Record<number, string> = {
  0x01: 'INVALID_FUNCTION',
  0x02: 'INVALID_ARGUMENT',
  0x03: 'OUT_OF_RANGE',
  0x04: 'HW_ERROR',
  0x05: 'LOG_ERROR',
  0x06: 'INVALID_FEATURE_INDEX',
  0x07: 'INVALID_FUNCTION_ID',
  0x08: 'BUSY',
  0x09: 'UNSUPPORTED',
};

/** HID++ 1.0 错误码（Solaar Hidpp10ErrorCodes，截选） */
const HIDPP1_ERRORS: Record<number, string> = {
  0x00: 'SUCCESS',
  0x01: 'INVALID_SUB_ID_COMMAND',
  0x02: 'INVALID_ADDRESS',
  0x03: 'INVALID_VALUE',
  0x04: 'CONNECTION_REQUEST_FAILED',
  0x05: 'TOO_MANY_DEVICES',
  0x06: 'KEY_ALREADY_EXISTS',
  0x07: 'KEY_NOT_FOUND',
  0x08: 'OPERATION_FAILED',
  0x09: 'UNKNOWN_DEVICE',
  0x0a: 'SET_DEFAULT_PARAMETERS_FAILED',
  0x0b: 'RESOURCE_UNAVAILABLE',
};

/** HID++ 1.0 错误码名（供自检旁听行解码用） */
export const hidpp1ErrorName = (code: number): string => HIDPP1_ERRORS[code] ?? `未知1.0错误${hex([code])}`;
/** HID++ 2.x 错误码名 */
export const hidpp2ErrorName = (code: number): string => HIDPP2_ERRORS[code] ?? `未知2.x错误${hex([code])}`;

export class HidppTimeoutError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'HidppTimeoutError';
  }
}
export class HidppWriteError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'HidppWriteError';
  }
}
export class HidppDeviceError extends Error {
  code: number;
  version1: boolean;
  constructor(code: number, version1: boolean) {
    super(`设备错误 ${hex([code])}（${(version1 ? HIDPP1_ERRORS : HIDPP2_ERRORS)[code] ?? '未知'}）`);
    this.name = 'HidppDeviceError';
    this.code = code;
    this.version1 = version1;
  }
}

export interface TraceFn {
  (line: string): void;
}

/**
 * 单个 WebHID 设备上的 HID++ 请求器。
 * inputreport 监听器常驻；请求串行排队（设备一次只处理一个请求）。
 */
export type HidppTransport = 'output' | 'feature';

export class HidppRequester {
  dev: HIDDeviceLike;
  private trace: TraceFn;
  private queue: Promise<unknown> = Promise.resolve();
  private listener: ((e: Event) => void) | null = null;
  private waiters = new Set<{
    reportId: number;
    devIdx: number;
    expectSw?: number;
    resolve: (data: number[]) => void;
  }>();
  /** 嗅探到的所有 inputreport（reportId 不匹配 / swId 不匹配的也会记录，供自检 raw 定位） */
  onStray: ((reportId: number, data: number[]) => void) | null = null;

  constructor(dev: HIDDeviceLike, trace: TraceFn = () => {}) {
    this.dev = dev;
    this.trace = trace;
  }

  async open(): Promise<void> {
    if (!this.dev.opened) await this.dev.open();
    if (!this.listener) {
      this.listener = (e: Event) => {
        const evt = e as unknown as { reportId: number; data: DataView };
        if (typeof evt.reportId !== 'number' || !evt.data) return;
        const data = Array.from(new Uint8Array(evt.data.buffer, evt.data.byteOffset, evt.data.byteLength));
        let matched = false;
        for (const w of this.waiters) {
          if (w.reportId !== evt.reportId || w.devIdx !== data[0]) continue;
          // swId 回显位置：正常应答在 body[2]（funcSw）；错误帧 0x8F/0xFF 在 body[3]
          // （布局 [devIdx, 0x8F|0xFF, featIdx, funcSw, errCode]），旧版只验 body[2]
          // 会把 1.0 接收器的 0x8F 错误帧误丢，导致 0x10/0xFF 永远超时。
          if (w.expectSw !== undefined) {
            const isErr = data[1] === 0x8f || data[1] === 0xff;
            const swByte = isErr ? data[3] : data[2];
            if ((swByte & 0x0f) !== w.expectSw) continue;
          }
          this.waiters.delete(w);
          w.resolve(data);
          matched = true;
          return;
        }
        if (!matched) this.onStray?.(evt.reportId, data);
      };
      this.dev.addEventListener('inputreport', this.listener);
    }
  }

  close(): void {
    if (this.listener) {
      this.dev.removeEventListener('inputreport', this.listener);
      this.listener = null;
    }
    this.waiters.clear();
  }

  private waitFor(reportId: number, devIdx: number, ms: number, expectSw?: number): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const w = { reportId, devIdx, expectSw, resolve };
      const timer = setTimeout(() => {
        this.waiters.delete(w);
        reject(new HidppTimeoutError(`等待 0x${reportId.toString(16)} 应答超时`));
      }, ms);
      w.resolve = (data) => {
        clearTimeout(timer);
        resolve(data);
      };
      this.waiters.add(w);
    });
  }

  /** 串行执行一个请求，避免并发请求互相串扰 */
  private run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * HID++ 2.x 特征请求。返回应答 payload（不含 reportId/devIdx/featIdx/funcSw 的 0 起始字节——
   * 返回完整 body：[devIdx, featIdx, funcSw, ...params]，便于上层按社区偏移解析）。
   * transport=output 走 sendReport；=feature 走 sendFeatureReport（部分 Win/Chrome 驱动组合
   * 下 output 报告写成功但设备收不到，feature 才是真通道；反之亦然，所以探测必须双试）。
   */
  request(
    reportId: number,
    devIdx: number,
    featIdx: number,
    func: number,
    params: number[],
    timeoutMs = 450,
    transport: HidppTransport = 'output',
  ): Promise<number[]> {
    return this.run(async () => {
      const bodyLen = reportId === REPORT_LONG ? 19 : 6;
      const paramLen = reportId === REPORT_LONG ? 16 : 3;
      const p = Array.from({ length: paramLen }, (_, i) => params[i] ?? 0);
      const body = [devIdx, featIdx, (func << 4) | SW_ID, ...p];
      const tag = transport === 'feature' ? 'F' : 'O';
      this.trace(`→ [${tag}] 0x${reportId.toString(16)} ${hex(body)}`);
      let wait: Promise<number[]>;
      try {
        wait = this.waitFor(reportId, devIdx, timeoutMs, SW_ID);
        if (transport === 'feature') {
          await this.dev.sendFeatureReport(reportId, new Uint8Array(body));
          // feature 请求的应答有的固件走 inputreport，有的只能 receiveFeatureReport 轮询，
          // 这里再起一路轮询，谁先命中谁算（waitFor 命中后另一路的 resolve 已失效）。
          void this.pollFeature(reportId, devIdx, timeoutMs).then(
            (data) => {
              for (const w of this.waiters) {
                if (w.devIdx !== data[0]) continue;
                const isErr = data[1] === 0x8f || data[1] === 0xff;
                const swByte = isErr ? data[3] : data[2];
                if (w.expectSw !== undefined && (swByte & 0x0f) !== w.expectSw) continue;
                this.waiters.delete(w);
                w.resolve(data);
                break;
              }
            },
            () => {},
          );
        } else {
          await this.dev.sendReport(reportId, new Uint8Array(body));
        }
      } catch (e) {
        if (e instanceof HidppWriteError) throw e;
        this.trace(`  [${tag}] 写入失败：${(e as Error).message}`);
        throw new HidppWriteError((e as Error).message);
      }
      let resp: number[];
      try {
        resp = await wait;
      } catch (e) {
        this.trace(`  ← [${tag}] 超时（${bodyLen + 1} 字节无应答）`);
        throw e;
      }
      this.trace(`← [${tag}] 0x${reportId.toString(16)} ${hex(resp)}`);
      if (resp[1] === 0x8f) throw new HidppDeviceError(resp[4], true);
      if (resp[1] === 0xff) throw new HidppDeviceError(resp[4], false);
      return resp;
    });
  }

  /** feature 读轮询：sendFeatureReport 后部分设备不发 inputreport，只能主动收 */
  private async pollFeature(reportId: number, devIdx: number, ms: number): Promise<number[]> {
    const t0 = Date.now();
    for (;;) {
      if (Date.now() - t0 > ms) throw new HidppTimeoutError('feature 轮询超时');
      try {
        const dv = await this.dev.receiveFeatureReport(reportId);
        const data = Array.from(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
        // receiveFeatureReport 有的实现带 reportId 头（data[0]==reportId），有的不带；两种都兼容
        const body = data[0] === reportId && data.length > (reportId === REPORT_LONG ? 19 : 6) ? data.slice(1) : data;
        if (body[0] === devIdx) return body;
      } catch {
        /* 设备无 feature 可读时抛错很正常，继续等 inputreport */
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  /** HID++ 1.0 寄存器读（旧设备电量等）；reg 0x07 = 电池放电等级 */
  requestRegister(
    reportId: number,
    devIdx: number,
    reg: number,
    timeoutMs = 450,
    transport: HidppTransport = 'output',
  ): Promise<number[]> {
    return this.run(async () => {
      const body = [devIdx, 0x81, reg, 0x00, 0x00, 0x00];
      const tag = transport === 'feature' ? 'F' : 'O';
      this.trace(`→ [${tag}] 0x${reportId.toString(16)} reg${hex([reg])} ${hex(body)}`);
      const wait = this.waitFor(reportId, devIdx, timeoutMs);
      try {
        if (transport === 'feature') {
          await this.dev.sendFeatureReport(reportId, new Uint8Array(body));
          void this.pollFeature(reportId, devIdx, timeoutMs).then(
            (data) => {
              for (const w of this.waiters) {
                if (w.devIdx !== data[0]) continue;
                this.waiters.delete(w);
                w.resolve(data);
                break;
              }
            },
            () => {},
          );
        } else await this.dev.sendReport(reportId, new Uint8Array(body));
      } catch (e) {
        throw new HidppWriteError((e as Error).message);
      }
      const resp = await wait.catch((e) => {
        this.trace(`  ← [${tag}] 超时`);
        throw e;
      });
      this.trace(`← [${tag}] 0x${reportId.toString(16)} ${hex(resp)}`);
      return resp;
    });
  }

  /**
   * ping（root feature 0x0000 / GetProtocolVersion）。
   * 2.x 设备回版本号；1.0 设备回 0x8F 错误（INVALID_SUB_ID_COMMAND）——也算「通道活着」。
   */
  async ping(
    reportId: number,
    devIdx: number,
    timeoutMs = 450,
    transport: HidppTransport = 'output',
  ): Promise<PingResult> {
    try {
      const resp = await this.request(reportId, devIdx, 0x00, 0x01, [0x00, 0x00, 0x5a], timeoutMs, transport);
      const major = resp[3];
      const minor = resp[4];
      if (major > 0) return { ok: true, protocol: major + minor / 10, version1: false };
      return { ok: false, protocol: null, version1: false };
    } catch (e) {
      if (e instanceof HidppDeviceError && e.version1 && e.code === 0x01) {
        return { ok: true, protocol: 1.0, version1: true };
      }
      return { ok: false, protocol: null, version1: false };
    }
  }
}

export interface PingResult {
  ok: boolean;
  protocol: number | null;
  version1: boolean;
}

/** 找到的可用通道（transport 记录探测胜出的传输，后续读写必须复用同一传输） */
export interface Channel {
  dev: HIDDeviceLike;
  requester: HidppRequester;
  reportId: number;
  devIdx: number;
  protocol: number;
  version1: boolean;
  transport: HidppTransport;
}

/** 该 WebHID 设备是否带 HID++ vendor collection（usagePage 0xff00） */
export function hasHidppCollections(d: HIDDeviceLike): boolean {
  return (d.collections ?? []).some((c) => c.usagePage === 0xff00);
}

export const fmtCollections = (d: HIDDeviceLike): string =>
  (d.collections ?? []).map((c) => `0x${c.usagePage.toString(16)}:0x${c.usage.toString(16)}`).join(' ') || '无';

/**
 * 通道探测：ping 扫 transport(output 优先) × reportId(0x11 优先) × deviceIndex(1..5、0、0xFF)。
 * 优先级：2.x 外设 > 2.x 接收器/直连 > 1.0 接收器（只能读寄存器）。
 * 真机参考：G304 在接收器后 = output/0x11/0x01；接收器自身 = output/0x10/0xFF(1.0)。
 * 用户本次全超时（c53f 三 collection 正确，但 14 个组合零应答）的两个已确认坑：
 * ① 旧版只验 body[2] 的 swId，把 1.0 的 0x8F 错误帧（swId 在 body[3]）误丢——已修；
 * ② 只试 sendReport(output)，部分 Win/Chrome 组合下真通道是 sendFeatureReport——本版双试。
 * 探测期间另挂 onStray 嗅探：任何 reportId/idx 对不上的回包都会记入 trace（~ 开头），
 * 下次 raw 若出现 ~ 行即说明“设备回了但地址不对”，可针对性修匹配。
 */
export async function findChannel(
  devs: HIDDeviceLike[],
  trace: TraceFn,
  timeoutMs = 450,
): Promise<{ channel: Channel | null; log: string[] }> {
  const log: string[] = [];
  // 0xff00 接口优先，但其他接口也试（带 0xff43 DFU 等特殊情况的设备）
  const ordered = [...devs].sort((a, b) => Number(hasHidppCollections(b)) - Number(hasHidppCollections(a)));
  let fallback: Channel | null = null;
  let strayCount = 0;
  for (const d of ordered) {
    const r = new HidppRequester(d, trace);
    try {
      await r.open();
    } catch (e) {
      log.push(`「${d.productName || '未知'}」打开失败：${(e as Error).message}`);
      continue;
    }
    r.onStray = (rid, data) => {
      strayCount++;
      if (strayCount > 16) return;
      // 0x8F/0xFF 错误帧直接解码，跨报告帧（1.0 接收器对 0x11 长报文回 0x10 短帧）单独标注：
      // 这是 c53f 的正常行为，不是 2.x 应答，也不用换线。
      let extra = '（未命中等待器：report/idx/sw 不匹配）';
      if (data[1] === 0x8f) {
        extra = `（1.0 错误帧 ${hidpp1ErrorName(data[4])}，码${hex([data[4]])}）` +
          (rid === REPORT_SHORT ? '；1.0 接收器对 0x11 长报文一律回 0x10 短错误帧，此行属正常代理行为' : '');
      } else if (data[1] === 0xff) {
        extra = `（2.x 错误帧 ${hidpp2ErrorName(data[4])}）`;
      }
      trace(`~ 旁听 input 0x${rid.toString(16)} ${hex(data)}${extra}`);
    };
    let found2x = false;
    let channel: Channel | null = null;
    for (const transport of ['output', 'feature'] as HidppTransport[]) {
      for (const reportId of [REPORT_LONG, REPORT_SHORT]) {
        for (const devIdx of [0x01, 0x02, 0x03, 0x04, 0x05, 0x00, DEVIDX_RECEIVER]) {
          let p: PingResult;
          try {
            p = await r.ping(reportId, devIdx, timeoutMs, transport);
          } catch {
            p = { ok: false, protocol: null, version1: false };
          }
          if (!p.ok) continue;
          const label = `「${d.productName || '未知'}」[${transport === 'feature' ? 'F' : 'O'}]0x${reportId.toString(16)}/idx${devIdx === 0xff ? '0xFF' : hex([devIdx])} → HID++ ${p.protocol}${p.version1 ? '（1.0 错误帧识别）' : ''}`;
          log.push(label);
          if (!p.version1) {
            found2x = true;
            channel = { dev: d, requester: r, reportId, devIdx, protocol: p.protocol ?? 0, version1: false, transport };
            break;
          }
          if (!fallback) {
            fallback = { dev: d, requester: r, reportId, devIdx, protocol: 1.0, version1: true, transport };
          }
          // 1.0 通道只作兜底，继续扫有没有 2.x 外设
        }
        if (found2x) break;
      }
      if (found2x) break;
      // output 全灭但抓到过旁听包 → 提示很可能只是地址不匹配，而不是设备不说话
      if (transport === 'output' && strayCount > 0 && !fallback) {
        log.push(`注：output 扫描期间旁听到 ${strayCount} 个 inputreport（见 raw 中 ~ 行），说明设备有回包但 report/idx 对不上，已继续试 feature 传输。`);
      }
    }
    r.onStray = null;
    if (channel) return { channel, log };
    // 没找到 2.x：本设备若贡献了 1.0 兜底则保持打开（供寄存器读电量），否则关闭
    if (fallback && fallback.dev === d) continue;
    r.close();
  }
  if (strayCount === 0) log.push('注：整个扫描期间未旁听到任何 inputreport（raw 中无 ~ 行），写入可能根本没到达设备：见下文排查。');
  return { channel: fallback, log };
}

// ---------------------------------------------------------------------------
// Feature 常量与解析（Solaar hidpp20.py 语义）
// ---------------------------------------------------------------------------

export const FEATURE = {
  ROOT: 0x0000,
  FEATURE_SET: 0x0001,
  DEVICE_FW_VERSION: 0x0003,
  DEVICE_NAME: 0x0005,
  BATTERY_STATUS: 0x1000,
  BATTERY_VOLTAGE: 0x1001,
  UNIFIED_BATTERY: 0x1004,
  ADJUSTABLE_DPI: 0x2201,
  EXTENDED_ADJUSTABLE_DPI: 0x2202,
  ONBOARD_PROFILES: 0x8100,
  // 灯效候选：0x8070 Color LED Effects 为主，0x1300 为部分机型的 LED 开关
  COLOR_LED_EFFECTS: 0x8070,
  RGB_EFFECTS: 0x8071,
  LED_CONTROL: 0x1300,
  // 回报率：0x8060 标准（ms），0x8061 扩展（含 sub-ms 档）
  REPORT_RATE: 0x8060,
  EXTENDED_ADJUSTABLE_REPORT_RATE: 0x8061,
  // 角度捕捉 0x2230：全球无公开实现（Solaar 仅常量、OpenLogi 仅列名无 func 文档），本项目只做存在性探测
  ANGLE_SNAPPING: 0x2230,
  // 改键：0x1B04 V4（临时映射，重启/重连需复施），0x1C00 持久映射（下一轮）
  REPROG_CONTROLS_V4: 0x1b04,
} as const;

export const BATTERY_STATUS_TEXT: Record<number, string> = {
  0: '放电中',
  1: '充电中',
  2: '即将充满',
  3: '已充满',
  4: '慢速充电（低于最优）',
  5: '电池无效',
  6: '温度异常',
};

const BATTERY_STATUS_TEXT_EN: Record<number, string> = {
  0: 'discharging',
  1: 'charging',
  2: 'almost full',
  3: 'full',
  4: 'slow charge (below optimum)',
  5: 'invalid battery',
  6: 'temperature fault',
};

/** 电池状态文案（查表缺席回退原文 hex 风格，调用方原样展示） */
export function batteryStatusText(code: number, locale: Locale = 'zh'): string {
  const table = locale === 'en' ? BATTERY_STATUS_TEXT_EN : BATTERY_STATUS_TEXT;
  return table[code] ?? `status ${hex([code])}`;
}

export interface BatteryInfo {
  level: number;
  next: number | null;
  status: number;
  statusText: string;
  method: string;
}

export interface FwInfo {
  kind: number;
  name: string;
  version: string;
  modelId: number | null;
}

export interface DpiInfo {
  list: number[];
  current: number;
  defaultDpi: number | null;
}

/** 在已建立的通道上做 feature 索引查询（带缓存） */
export class FeatureMap {
  private map = new Map<number, number>();
  private ch: Channel;

  constructor(ch: Channel) {
    this.ch = ch;
  }

  async index(fid: number): Promise<number> {
    if (this.map.has(fid)) return this.map.get(fid) as number;
    const resp = await this.ch.requester.request(this.ch.reportId, this.ch.devIdx, 0x00, 0x00, [
      (fid >> 8) & 0xff,
      fid & 0xff,
      0x00,
    ], 450, this.ch.transport);
    const idx = resp[3];
    this.map.set(fid, idx);
    return idx;
  }

  /** 返回 0 表示设备不支持该 feature（不抛错） */
  async tryIndex(fid: number): Promise<number> {
    try {
      return await this.index(fid);
    } catch (e) {
      if (e instanceof HidppDeviceError) return 0;
      throw e;
    }
  }
}

/** 设备名（0x0005）：f0 长度，f1 分片读，offset 参数
 * 注意：f1 回包无 offset 回显（Solaar get_name 取 fragment[0:]），分片字节从 resp[3] 起。
 * 旧版 slice(4) 每片吞掉首字节，导致 "G304" 变 "304"、边界错位出 "Gaminng"，已修。 */
export async function readDeviceName(ch: Channel, feats: FeatureMap): Promise<string> {
  const f = await feats.tryIndex(FEATURE.DEVICE_NAME);
  if (!f) return '';
  const lenResp = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x00, [0x00], 450, ch.transport);
  const len = Math.min(lenResp[3] ?? 0, 50);
  let name = '';
  for (let off = 0; off < len && name.length < len; off += 14) {
    const chunk = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x01, [off], 450, ch.transport);
    const chars = chunk
      .slice(3)
      .filter((c) => c >= 0x20 && c < 0x7f)
      .map((c) => String.fromCharCode(c));
    if (!chars.length) break;
    name += chars.join('');
  }
  return name.trim();
}

/** 固件信息（0x0003）：kind/name/version/modelId */
export async function readFirmware(ch: Channel, feats: FeatureMap): Promise<FwInfo[]> {
  const f = await feats.tryIndex(FEATURE.DEVICE_FW_VERSION);
  if (!f) return [];
  const cntResp = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x00, [0x00], 450, ch.transport);
  const count = Math.min(cntResp[3] ?? 0, 4);
  const out: FwInfo[] = [];
  for (let i = 0; i < count; i++) {
    const resp = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x01, [i], 450, ch.transport);
    const kind = resp[3] & 0x0f;
    if (kind === 0 || kind === 1) {
      const name = resp
        .slice(4, 7)
        .filter((c) => c >= 0x20 && c < 0x7f)
        .map((c) => String.fromCharCode(c))
        .join('');
      const major = resp[7] ?? 0;
      const minor = resp[8] ?? 0;
      const build = ((resp[9] ?? 0) << 8) | (resp[10] ?? 0);
      const modelId = ((resp[12] ?? 0) << 8) | (resp[13] ?? 0) || null;
      out.push({
        kind,
        name,
        version: `${major.toString(16).padStart(2, '0').toUpperCase()}.${minor.toString(16).padStart(2, '0').toUpperCase()}${build ? `.B${build.toString(16).padStart(4, '0').toUpperCase()}` : ''}`,
        modelId,
      });
    }
  }
  return out;
}

/**
 * 电量：优先 UNIFIED_BATTERY 0x1004(f1)，再 BATTERY_STATUS 0x1000(f0)，
 * 再 BATTERY_VOLTAGE 0x1001(f0，无参，mV 查表估算，仅做回退/充电态补充)，
 * 最后 1.0 寄存器 0x07/0x0D（仅 1.0 通道）。G304 实测 0x1000 → [90, 50, 0]。
 */
export async function readBattery(ch: Channel, feats: FeatureMap, locale: Locale = 'zh'): Promise<BatteryInfo | null> {
  const fU = await feats.tryIndex(FEATURE.UNIFIED_BATTERY);
  if (fU) {
    try {
      // 注意：本 request() 为 (func<<4)|swId，传功能号 0x01（Solaar 记 0x10）；旧版误传 0x10 会发功能 0，已修
      const resp = await ch.requester.request(ch.reportId, ch.devIdx, fU, 0x01, [0x00], 450, ch.transport);
      const level = resp[3];
      const status = resp[5];
      if (level > 0 && level <= 100) {
        return {
          level, next: null, status,
          statusText: batteryStatusText(status, locale),
          method: '0x1004 UnifiedBattery',
        };
      }
    } catch {
      /* 回退 */
    }
  }
  const fS = await feats.tryIndex(FEATURE.BATTERY_STATUS);
  if (fS) {
    try {
      const resp = await ch.requester.request(ch.reportId, ch.devIdx, fS, 0x00, [0x00], 450, ch.transport);
      const level = resp[3];
      const next = resp[4];
      const status = resp[5];
      if (level > 0 && level <= 100) {
        return {
          level, next: next || null, status,
          statusText: batteryStatusText(status, locale),
          method: '0x1000 BatteryStatus',
        };
      }
    } catch {
      /* 回退 */
    }
  }
  // 0x1001 电压回退（Solaar decipher_battery_voltage：f0 无参 → [voltHi, voltLo, flags]，% 查表估算）
  const fV = await feats.tryIndex(FEATURE.BATTERY_VOLTAGE);
  if (fV) {
    try {
      const info = await readBatteryVoltage(ch, feats, locale);
      if (info) return info;
    } catch {
      /* 回退 */
    }
  }
  if (ch.version1 || ch.devIdx === DEVIDX_RECEIVER) {
    // 1.0 寄存器读：idx 逐个试（接收器自身 FF 优先，其后鼠标槽 01..05/00 也试——
    // DJ 接收器后鼠标的电池寄存器挂在鼠标槽下，FF 读到的可能是接收器代理值）；
    // 每个 idx 再 output/feature 双试。method 标注来源 idx，便于自检页判断。
    const idxOrder = [ch.devIdx, ...([0x01, 0x02, 0x03, 0x04, 0x05, 0x00, DEVIDX_RECEIVER].filter((i) => i !== ch.devIdx))];
    const transports: HidppTransport[] = [ch.transport, ch.transport === 'output' ? 'feature' : 'output'];
    // Solaar hidpp10 顺序：0x07 电量档 → 0x0D 充电量，无声明时两个都试
    for (const reg of [0x07, 0x0d]) {
      for (const idx of idxOrder) {
        for (const t of transports) {
          try {
            const resp = await ch.requester.requestRegister(REPORT_SHORT, idx, reg, 450, t);
            const level = resp[3];
            if (level >= 1 && level <= 100) {
              const idxTag = idx === 0xff ? 'idxFF' : `idx${hex([idx])}`;
              const regTag = reg === 0x07 ? 'reg07' : 'reg0D';
              return { level, next: null, status: 0, statusText: batteryStatusText(0, locale), method: `1.0 ${regTag}[${t === 'feature' ? 'F' : 'O'}/${idxTag}] raw:${hex(resp)}` };
            }
          } catch {
            /* 换下一种组合 */
          }
        }
      }
    }
  }
  return null;
}

/** 电压→电量%查表（Solaar estimate_battery_level_percentage，mV 高→低） */
const VOLTAGE_TABLE: Array<[number, number]> = [
  [4186, 100], [4067, 90], [3989, 80], [3922, 70], [3859, 60], [3811, 50],
  [3778, 40], [3751, 30], [3717, 20], [3671, 10], [3646, 5], [3579, 2], [3500, 0],
];

function voltageToLevel(mv: number): number {
  if (mv >= VOLTAGE_TABLE[0][0]) return 100;
  const last = VOLTAGE_TABLE[VOLTAGE_TABLE.length - 1];
  if (mv <= last[0]) return 0;
  for (let i = 0; i < VOLTAGE_TABLE.length - 1; i++) {
    const [hiMv, hiPct] = VOLTAGE_TABLE[i];
    const [loMv, loPct] = VOLTAGE_TABLE[i + 1];
    if (mv <= hiMv && mv >= loMv) {
      const t = (mv - loMv) / (hiMv - loMv || 1);
      return Math.round(loPct + t * (hiPct - loPct));
    }
  }
  return 0;
}

/**
 * 0x1001 电压电量（Solaar get_battery_voltage/decipher_battery_voltage）：
 * f0 无参 → [voltHi, voltLo, flags]；% 为查表估算（UI 应标“约”），精确值仍以 0x1004/0x1000 为准。
 */
export async function readBatteryVoltage(ch: Channel, feats: FeatureMap, locale: Locale = 'zh'): Promise<BatteryInfo | null> {
  const f = await feats.tryIndex(FEATURE.BATTERY_VOLTAGE);
  if (!f) return null;
  const resp = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x00, [], 450, ch.transport);
  if (resp.length < 6) return null;
  const mv = ((resp[3] ?? 0) << 8) | (resp[4] ?? 0);
  const flags = resp[5] ?? 0;
  if (mv <= 0) return null;
  const level = voltageToLevel(mv);
  const recharging = (flags & 0x80) !== 0;
  const chargeState = flags & 0x03;
  const slow = (flags & 0x10) !== 0;
  const critical = (flags & 0x20) !== 0;
  // Solaar 语义：FULL 优先，其次充电（含慢充标注），再严重不足，最后放电中
  const en = locale === 'en';
  const statusText = chargeState === 1 ? (en ? 'full' : '已充满') : recharging ? (slow ? (en ? 'slow charging' : '慢速充电中') : (en ? 'charging' : '充电中')) : critical ? (en ? 'critically low' : '电量严重不足') : batteryStatusText(0, locale);
  return { level, next: null, status: chargeState, statusText, method: `0x1001 BatteryVoltage（约${level}% · ${mv}mV）` };
}

/**
 * DPI 档位表（Solaar produce_dpi_list 语义）：
 * 词高 3 位为 0b111 → 步进条目：step=低 13 位，last=下一词，展开区间；
 * 0x0000 终止。G304 实测 [200, {step50→12000}] → 200..12000 步进 50。
 */
export function decodeDpiList(bytes: number[]): number[] {
  const list: number[] = [];
  let i = 0;
  while (i + 1 < bytes.length && list.length < 1000) {
    const val = (bytes[i] << 8) | bytes[i + 1];
    if (val === 0) break;
    if ((val >> 13) === 0b111) {
      const step = val & 0x1fff;
      const last = (bytes[i + 2] ?? 0) << 8 | (bytes[i + 3] ?? 0);
      const prev = list[list.length - 1];
      if (!prev || step === 0 || last <= prev) break;
      for (let v = prev + step; v <= last; v += step) list.push(v);
      i += 4;
    } else {
      list.push(val);
      i += 2;
    }
  }
  return list;
}

/** DPI：档位表（0x2201 f1，分片）+ 当前值（f2，0 时用默认值——Solaar validate_read 同款） */
export async function readDpi(ch: Channel, feats: FeatureMap): Promise<DpiInfo | null> {
  const f = await feats.tryIndex(FEATURE.ADJUSTABLE_DPI);
  if (f) {
    // 档位表：params [sensor=0, direction=0, chunk]，回包 [sensorEcho, ...words]，00 00 结尾
    const chunks: number[] = [];
    for (let i = 0; i < 8; i++) {
      const resp = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x01, [0x00, 0x00, i], 450, ch.transport);
      const data = resp.slice(4);
      chunks.push(...data);
      if (chunks.length >= 2 && chunks[chunks.length - 1] === 0 && chunks[chunks.length - 2] === 0) break;
    }
    const list = decodeDpiList(chunks);
    // 当前值：f2 → [sensorEcho, dpiHi, dpiLo, defaultHi, defaultLo]
    const cur = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x02, [0x00], 450, ch.transport);
    let current = (cur[4] << 8) | cur[5];
    const defaultDpi = (cur[6] << 8) | cur[7] || null;
    if (current === 0) current = defaultDpi ?? 0;
    return { list, current, defaultDpi };
  }
  // 回退：0x2202 扩展 DPI（Solaar dpi_extended；设备只暴露其一）。只取 X 轴，
  // Y/LOD 仅 trace 展示不扩模型；写仍走 0x2201 路径（缺席则上层回本地）。
  return readDpiExtended(ch, feats);
}

export const LOD_NAMES = ['低', '中', '高'] as const;

/**
 * 0x2202 扩展 DPI 读（Solaar ExtendedAdjustableDpi）：
 * - 能力 f0x10 [0x00] → reply[2] bit0=Y独立 bit1=LOD（本函数 resp[5]）
 * - 表 f0x20 [0x00, direction, chunk] → 跳 3B 后同 0x2201 解码
 * - 当前 f0x50 → X现 resp[4:6]（0 则 X默认 resp[6:8]），Y现 resp[8:10]（有 Y 时），LOD resp[12]（有 LOD 时）
 */
export async function readDpiExtended(
  ch: Channel,
  feats: FeatureMap,
  trace?: (line: string) => void,
): Promise<DpiInfo | null> {
  const f = await feats.tryIndex(FEATURE.EXTENDED_ADJUSTABLE_DPI);
  if (!f) return null;
  // 功能号风格：能力 0x01 / 表 0x02 / 当前 0x05（Solaar 记 0x10/0x20/0x50）
  const cap = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x01, [0x00], 450, ch.transport);
  const hasY = ((cap[5] ?? 0) & 0x01) !== 0;
  const hasLOD = ((cap[5] ?? 0) & 0x02) !== 0;
  trace?.(`0x2202 能力：${hex(cap)}（${hasY ? 'X/Y独立' : '单轴'}${hasLOD ? ' + LOD' : ''}）`);
  const chunks: number[] = [];
  for (let i = 0; i < 8; i++) {
    const resp = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x02, [0x00, 0x00, i], 450, ch.transport);
    const data = resp.slice(6);
    chunks.push(...data);
    if (chunks.length >= 2 && chunks[chunks.length - 1] === 0 && chunks[chunks.length - 2] === 0) break;
  }
  const list = decodeDpiList(chunks);
  const cur = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x05, [0x00], 450, ch.transport);
  let current = ((cur[4] ?? 0) << 8) | (cur[5] ?? 0);
  const defaultDpi = (((cur[6] ?? 0) << 8) | (cur[7] ?? 0)) || null;
  if (current === 0) current = defaultDpi ?? 0;
  if (hasY) {
    // Solaar：Y 为 0 时回退备用字节（dpi_y = reply[7:9] if reply[5:7]==0）
    let y = ((cur[8] ?? 0) << 8) | (cur[9] ?? 0);
    if (y === 0) y = ((cur[10] ?? 0) << 8) | (cur[11] ?? 0);
    trace?.(`0x2202 Y 轴当前 ${y}（本页单值模型，只取 X=${current}，Y 仅展示）`);
  }
  if (hasLOD) {
    const lod = cur[12] ?? 0;
    trace?.(`0x2202 LOD 当前 ${LOD_NAMES[lod] ?? lod}（仅展示，不写设备）`);
  }
  return { list, current, defaultDpi };
}

/** 写当前 DPI（0x2201 f3：[sensor=0, dpiHi, dpiLo]） */
export async function writeDpi(ch: Channel, feats: FeatureMap, dpi: number): Promise<void> {
  const f = await feats.index(FEATURE.ADJUSTABLE_DPI);
  if (!f) throw new Error('设备不支持 0x2201 AdjustDPI');
  await ch.requester.request(ch.reportId, ch.devIdx, f, 0x03, [0x00, (dpi >> 8) & 0xff, dpi & 0xff], 450, ch.transport);
}

export interface LodInfo {
  hasY: boolean;
  hasLOD: boolean;
  /** 当前 LOD（OpenLogi 编码 1低/2中/3高；0=不支持；读不到为 null） */
  lod: number | null;
  raw: string;
}

/**
 * 0x2202 LOD 能力探测 + 当前值（Solaar ExtendedAdjustableDpi.build + OpenLogi x2202 wire 格式，
 * 两边 capability/X/Y/LOD 偏移一致；LOD 编码用 OpenLogi 的 1/2/3——Solaar validator 写 LOW=0
 * 与自家 universe 1/2/3 自相矛盾且从未被真机行使过，不采用）。
 * G304 这类只有 0x2201 的鼠标 tryIndex 直接回 0，上层即判“无 LOD 硬件”。
 */
export async function readLodInfo(
  ch: Channel,
  feats: FeatureMap,
  trace?: (line: string) => void,
): Promise<LodInfo | null> {
  const f = await feats.tryIndex(FEATURE.EXTENDED_ADJUSTABLE_DPI);
  if (!f) return null;
  const cap = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x01, [0x00], 450, ch.transport);
  const hasY = (((cap[5] ?? 0) & 0x01) !== 0);
  const hasLOD = (((cap[5] ?? 0) & 0x02) !== 0);
  let lod: number | null = null;
  if (hasLOD) {
    try {
      const cur = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x05, [0x00], 450, ch.transport);
      const v = cur[12] ?? 0;
      if (v >= 1 && v <= 3) lod = v;
      trace?.(`0x2202 LOD 当前 ${lod ?? `未知值${v}`}（1低/2中/3高）`);
    } catch (e) {
      trace?.(`0x2202 读 LOD 当前值失败：${(e as Error).message}`);
    }
  }
  trace?.(`0x2202 能力：${hex(cap)}（${hasY ? 'X/Y独立' : '单轴'}${hasLOD ? ' + LOD' : '，无 LOD'}）`);
  return { hasY, hasLOD, lod, raw: hex(cap) };
}

/**
 * 写 LOD（0x2202 fn6：[sensor=0, xHi, xLo, yHi, yLo, lod]，Solaar prepare_write 同款）：
 * 先读回当前 X/Y 原样带回（无 Y 时 Y=0），只换 LOD，避免误改分辨率；X 读回 0 则拒绝写入。
 */
export async function writeLod(ch: Channel, feats: FeatureMap, lod: 1 | 2 | 3): Promise<void> {
  const f = await feats.tryIndex(FEATURE.EXTENDED_ADJUSTABLE_DPI);
  if (!f) throw new Error('设备无 0x2202（G304 这类只有 0x2201 的鼠标正常缺席），LOD 写不了硬件');
  const cur = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x05, [0x00], 450, ch.transport);
  let x = (((cur[4] ?? 0) << 8) | (cur[5] ?? 0));
  if (x === 0) x = (((cur[6] ?? 0) << 8) | (cur[7] ?? 0));
  if (x === 0) throw new Error('读回当前 DPI 为 0，拒绝写 LOD（避免误改分辨率）');
  const y = (((cur[8] ?? 0) << 8) | (cur[9] ?? 0));
  await ch.requester.request(
    ch.reportId, ch.devIdx, f, 0x06,
    [0x00, (x >> 8) & 0xff, x & 0xff, (y >> 8) & 0xff, y & 0xff, lod],
    450, ch.transport,
  );
}

/** 实测 DPI 表 → 范围/步进（通用自学习用，不再只信型号表） */
export function deriveDpiRange(list: number[]): { min: number; max: number; step: number } | null {
  if (!list.length) return null;
  const min = list[0];
  const max = list[list.length - 1];
  const diffs: number[] = [];
  for (let i = 1; i < Math.min(list.length, 20); i++) diffs.push(list[i] - list[i - 1]);
  const freq = new Map<number, number>();
  for (const d of diffs) {
    if (d > 0) freq.set(d, (freq.get(d) ?? 0) + 1);
  }
  let step = 0;
  let best = 0;
  for (const [d, n] of freq) {
    if (n > best) {
      best = n;
      step = d;
    }
  }
  return { min, max, step: step || diffs[0] || 50 };
}

export interface OnboardDesc {
  count: number | null;
  raw: string;
}

/** 板载组数读取（0x8100，防御式）：缺席返回 null；存在则试 f0，解析保守，raw 必留 */
export async function readOnboardDesc(
  ch: Channel,
  feats: FeatureMap,
  trace?: (line: string) => void,
): Promise<OnboardDesc | null> {
  const f = await feats.tryIndex(FEATURE.ONBOARD_PROFILES);
  if (!f) return null;
  try {
    const resp = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x00, [0x00], 450, ch.transport);
    const raw = hex(resp);
    trace?.(`0x8100 f0 描述：${raw}`);
    // Solaar from_device 布局（其 response 为去头后的 params）：[memory, profile, macro, count, oob, buttons, sectors, sizeHi, sizeLo, shift]
    // 本函数 resp 带 3 字节头，故 memory=resp[3]，count=resp[6]；旧版误把 memory 当 count，会恒得 1。
    const memory = resp[3];
    if (memory !== 0x01) return { count: null, raw: `${raw}（首字节非 0x01，布局未知，待补解析）` };
    if ((resp[4] ?? 0) > 0x05) return { count: null, raw: `${raw}（profile 字节超范围，布局未知，待补解析）` };
    const c = resp[6];
    const count = c >= 1 && c <= 8 ? c : null;
    return { count, raw };
  } catch (e) {
    trace?.(`0x8100 f0 读取失败：${(e as Error).message}`);
    return { count: null, raw: `f0 读取失败：${(e as Error).message}` };
  }
}

/** 灯效支持探测：0x8070 / 0x1300 任一存在即认为有灯 */
export async function detectLighting(feats: FeatureMap): Promise<boolean> {
  const a = await feats.tryIndex(FEATURE.COLOR_LED_EFFECTS);
  if (a) return true;
  const r = await feats.tryIndex(FEATURE.RGB_EFFECTS);
  if (r) return true;
  const b = await feats.tryIndex(FEATURE.LED_CONTROL);
  return !!b;
}

/**
 * 板载模式（Solaar set_onboard_mode/get 语义，0x8100）：
 * - 读 f0x20 无参 → mode：0x01 板载生效 / 0x02 主机接管（0x00 为占位）
 * - 写 f0x10 [mode]：0x01 切回板载，0x02 禁用板载（DPI/回报率/灯/改键直写才有效）
 * 注意：切 HOST 会改变用户板载行为，UI 必须明确告知；读失败视为未知（null）。
 */
export async function readOnboardMode(ch: Channel, feats: FeatureMap): Promise<number | null> {
  const f = await feats.tryIndex(FEATURE.ONBOARD_PROFILES);
  if (!f) return null;
  try {
    // 功能号 0x02（Solaar 记 0x20）
    const resp = await ch.requester.request(ch.reportId, ch.devIdx, f, 0x02, [], 450, ch.transport);
    return resp[3] ?? null;
  } catch {
    return null;
  }
}

export async function writeOnboardMode(ch: Channel, feats: FeatureMap, mode: 0x01 | 0x02): Promise<void> {
  const f = await feats.index(FEATURE.ONBOARD_PROFILES);
  if (!f) throw new Error('设备不支持 0x8100 板载模式切换');
  // 功能号 0x01（Solaar 记 0x10）
  await ch.requester.request(ch.reportId, ch.devIdx, f, 0x01, [mode], 450, ch.transport);
}

export function onboardModeName(mode: number | null, locale: Locale = 'zh'): string {
  const en = locale === 'en';
  if (mode === 0x01) return en ? 'onboard active' : '板载生效';
  if (mode === 0x02) return en ? 'host-controlled (onboard off)' : '主机接管（板载已禁用）';
  if (mode == null) return en ? 'unknown' : '未知';
  return en ? `unknown mode 0x${mode.toString(16)}` : `未知模式0x${mode.toString(16)}`;
}
