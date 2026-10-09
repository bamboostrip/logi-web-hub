import type { HIDDeviceLike } from './types';

/**
 * 【仅 DEV】?mockhid=1 时用真机抓包字节回放 WebHID（G304 + 046d:c53f 接收器，2026-10 实测），
 * 用于无硬件时全流程自测。生产构建经 import.meta.env.DEV 裁剪，不打包。
 *
 * 回放要点（与真机行为一致）：
 * - 接收器 iface1（无 0xff00 collection）写任何 report 都抛错（连错口）；
 * - 接收器 iface2（HID++ 口）idx 0xFF 只在 0x10 回 1.0 错误帧；idx 0x01 只在 0x11、swId 非零时应答（协议 4.2）；
 * - output / feature 两种传输都回放（真机 output 胜出，feature 同样可达，便于验证双传输逻辑）。
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MOUSE_NAME = 'G304 Lightspeed Wireless Gaming Mouse';

function frame(reportId: number, body: number[]): Event {
  const padded = [...body];
  while (padded.length < (reportId === 0x11 ? 19 : 6)) padded.push(0);
  const ev = new Event('inputreport');
  Object.defineProperty(ev, 'reportId', { value: reportId });
  Object.defineProperty(ev, 'data', { value: new DataView(new Uint8Array(padded).buffer) });
  return ev;
}

class MockHidDevice extends EventTarget implements HIDDeviceLike {
  vendorId = 0x046d;
  productId = 0xc53f;
  productName: string;
  collections: Array<{ usagePage: number; usage: number }>;
  opened = false;
  oninputreport: ((e: { data: DataView; reportId: number }) => void) | null = null;
  hidpp: boolean;

  constructor(opts: { productName: string; collections: Array<{ usagePage: number; usage: number }>; hidpp: boolean }) {
    super();
    this.productName = opts.productName;
    this.collections = opts.collections;
    this.hidpp = opts.hidpp;
  }

  async open(): Promise<void> {
    this.opened = true;
  }
  async close(): Promise<void> {
    this.opened = false;
  }

  private pendingFeature = new Map<number, number[]>();

  async sendFeatureReport(reportId: number, data: BufferSource): Promise<void> {
    if (!this.hidpp) throw new Error('Failed to write the report.');
    const u8 =
      data instanceof DataView
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data as ArrayBufferLike);
    // feature 传输与 output 同语义：记一份可轮询的 feature 应答，同时也走 inputreport 事件
    const resp = this.computeResponse(reportId, Array.from(u8));
    if (resp) {
      this.pendingFeature.set(reportId, resp);
      this.respond(reportId, resp);
    }
  }
  async receiveFeatureReport(reportId: number): Promise<DataView> {
    const resp = this.pendingFeature.get(reportId);
    if (!resp) throw new Error('Failed to read feature report.');
    this.pendingFeature.delete(reportId);
    return new DataView(new Uint8Array(resp).buffer);
  }

  private respond(reportId: number, body: number[]): void {
    setTimeout(() => this.dispatchEvent(frame(reportId, body)), 15 + Math.random() * 30);
  }

  async sendReport(reportId: number, data: BufferSource): Promise<void> {
    if (!this.hidpp) throw new Error('Failed to write the report.');
    const u8 =
      data instanceof DataView
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data as ArrayBufferLike);
    const resp = this.computeResponse(reportId, Array.from(u8));
    if (resp) this.respond(reportId, resp);
  }

  private computeResponse(reportId: number, b: number[]): number[] | null {
    const devIdx = b[0];
    const featIdx = b[1];
    const funcSw = b[2];
    const func = funcSw >> 4;
    const sw = funcSw & 0x0f;
    const mk = (params: number[]) => [devIdx, featIdx, funcSw, ...params];

    // —— 真机行为：idx 0xFF 只有 0x10 上的 1.0 错误帧；0x10 的 idx 0x01 无应答 ——
    if (reportId === 0x10) {
      if (devIdx === 0xff) return [devIdx, 0x8f, featIdx, funcSw, 0x01];
      return null; // 其余组合真机静默
    }
    // —— 0x11：只有鼠标 idx 0x01 + 非零 swId 应答 ——
    if (reportId !== 0x11 || devIdx !== 0x01 || sw === 0) return null;

    if (featIdx === 0x00 && func === 0x01) {
      // ping → HID++ 4.2（mark 回显）
      return mk([0x04, 0x02, b[5] ?? 0x5a]);
    }
    if (featIdx === 0x00 && func === 0x00) {
      // getFeature：0x2201→26, 0x1000→5, 0x1004→0(不支持), 0x0005→3, 0x0003→2, 0x0001→1, 0x8100→7,
      // 0x8060→8(回报率，G304 有), 0x1b04→10(改键链路测试桩，真机 G304 无), 0x8070→0(G304 无灯)
      const fid = (b[3] << 8) | b[4];
      const table: Record<number, number> = { 0x2201: 26, 0x1000: 5, 0x1004: 0, 0x0005: 3, 0x0003: 2, 0x0001: 1, 0x8100: 7, 0x8060: 8, 0x1b04: 10, 0x8070: 0, 0x1300: 0 };
      return mk([table[fid] ?? 0]);
    }
    if (featIdx === 0x03) {
      // DEVICE_NAME：f0 长度 0x25=37；f1 offset 分片（回包无 offset 回显，纯字符分片，Solaar get_name 同款）
      if (func === 0x00) return mk([MOUSE_NAME.length]);
      if (func === 0x01) {
        const off = b[3];
        const chunk = MOUSE_NAME.slice(off, off + 14);
        return [devIdx, featIdx, funcSw, ...chunk.split('').map((c) => c.charCodeAt(0))];
      }
      return null;
    }
    if (featIdx === 0x02) {
      // DEVICE_FW_VERSION：count=2；实体0=RQM(kind0) 实体1=BOT(kind1)，model 0x4074
      if (func === 0x00) return mk([0x02]);
      if (func === 0x01) {
        const e = b[3] ?? 0;
        if (e === 0) return [devIdx, featIdx, funcSw, 0x00, 0x52, 0x51, 0x4d, 0x68, 0x00, 0x00, 0x11, 0x01, 0x40, 0x74];
        return [devIdx, featIdx, funcSw, 0x01, 0x42, 0x4f, 0x54, 0x69, 0x00, 0x00, 0x11, 0x00, 0x40, 0x74];
      }
      return null;
    }
    if (featIdx === 0x05 && func === 0x00) {
      // BATTERY_STATUS：90%、下一阈值 50%、放电中
      return mk([0x5a, 0x32, 0x00]);
    }
    if (featIdx === 0x07) {
      // ONBOARD_PROFILES f0（Solaar 布局）：[memory=1, profile, macro, count=1] → G304 单组
      if (func === 0x00) return mk([0x01, 0x00, 0x00, 0x01]);
      // f0x20→功能号 0x02 板载模式：0x01 板载生效（G304 真相）；f0x10→0x01 写回显
      if (func === 0x02) return mk([0x01]);
      if (func === 0x01) return mk([b[3] ?? 0x01]);
      return null;
    }
    if (featIdx === 0x1a) {
      // ADJUSTABLE_DPI：f1 档位表（200 + 步进50→12000），f2 当前 1000/默认 800，f3 写回显
      if (func === 0x01) return mk([0x00, 0x00, 0xc8, 0xe0, 0x32, 0x2e, 0xe0, 0x00, 0x00]);
      if (func === 0x02) return mk([0x00, 0x03, 0xe8, 0x03, 0x20]);
      if (func === 0x03) return mk([b[3] ?? 0, b[4] ?? 0, b[5] ?? 0]);
      return null;
    }
    if (featIdx === 0x08) {
      // REPORT_RATE 0x8060（功能号风格）：f0 掩码 0x8B（1/2/4/8ms→125/250/500/1000Hz），f0x01 当前 1ms，f0x02 写回显
      if (func === 0x00) return mk([0x8b]);
      if (func === 0x01) return mk([0x01]);
      if (func === 0x02) return mk([b[3] ?? 0x01]);
      return null;
    }
    if (featIdx === 0x0a) {
      // REPROG 0x1B04 回放：注意 G304/G305 真机无此 feature（Solaar #850 定论），这里是“假设有改键的鼠标”的
      // 读写链路测试桩（6 键自洽示例，非 G304 抓包），用于验证有灯/多键游戏鼠的改键页；G304 真机走“无 0x1B04”分支。
      const CIDS = [0x0050, 0x0051, 0x0052, 0x0053, 0x0056, 0x00ed];
      if (func === 0x00) return mk([CIDS.length]);
      if (func === 0x01) {
        const i = b[3] ?? 0;
        const cid = CIDS[i] ?? 0;
        if (!cid) return null;
        const group = i < 3 ? 0 : i < 5 ? 1 : 2;
        return mk([(cid >> 8) & 0xff, cid & 0xff, (cid >> 8) & 0xff, cid & 0xff, 0x01, i, group, 0xff, 0x00]);
      }
      if (func === 0x02) {
        const cid = ((b[3] ?? 0) << 8) | (b[4] ?? 0);
        return mk([(cid >> 8) & 0xff, cid & 0xff, 0x00, (cid >> 8) & 0xff, cid & 0xff]);
      }
      if (func === 0x03) return mk([b[3] ?? 0, b[4] ?? 0, b[5] ?? 0, b[6] ?? 0, b[7] ?? 0]);
      return null;
    }
    // 未覆盖的组合静默（真机对未知 feature 多为错误帧，这里省略不影响验证路径）
    return null;
  }
}

const ifaceConsumer = new MockHidDevice({
  productName: 'USB Receiver',
  collections: [
    { usagePage: 0x000c, usage: 0x0001 },
    { usagePage: 0xffbc, usage: 0x88 },
  ],
  hidpp: false,
});
const ifaceHidpp = new MockHidDevice({
  productName: 'USB Receiver',
  collections: [
    { usagePage: 0xff00, usage: 0x04 },
    { usagePage: 0xff00, usage: 0x01 },
    { usagePage: 0xff00, usage: 0x02 },
  ],
  hidpp: true,
});

export function installDevMock(): void {
  const hid = {
    async requestDevice() {
      await sleep(50);
      return [ifaceHidpp];
    },
    async getDevices() {
      return [ifaceConsumer, ifaceHidpp];
    },
  };
  // navigator.hid 是原型上的只读 getter，需 redefine
  try {
    Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
  } catch {
    Object.defineProperty(navigator, 'hid', { value: hid, configurable: true });
  }
  console.info('[devMock] WebHID 已替换为真机抓包回放（G304 @ 0xc53f）');
}
