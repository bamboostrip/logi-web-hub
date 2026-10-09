/**
 * WebHID + HID++ 2.0 类型定义
 * GPW 1代 / G304 都是 HID++ 2.0 + 板载内存：调一次写进鼠标，换机不丢。
 */

/** Chromium 的 WebHID 类型（TS 默认没有，精简声明避免 any 泛滥） */
export interface HIDDeviceLike extends EventTarget {
  vendorId: number;
  productId: number;
  productName: string;
  collections: Array<{ usagePage: number; usage: number }>;
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  sendFeatureReport(reportId: number, data: BufferSource): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
  oninputreport: ((e: { data: DataView; reportId: number }) => void) | null;
}

export type ConnectionType = 'wired' | 'lightspeed' | 'unknown';

export interface SupportedDevice {
  /** 展示名 */
  name: string;
  /** USB VID，罗技一律 0x046d */
  vendorId: number;
  /** 有线 / 接收器模式下的 PID 列表 */
  productIds: number[];
  /** 传感器 DPI 范围 */
  dpiMin: number;
  dpiMax: number;
  dpiStep: number;
  /** 板载 DPI 档位数（单个配置内的 DPI 档位，如 G304 是 4 档） */
  dpiSlots: number;
  /** 鼠标板载能存几组完整配置（不同鼠标数量不同，如入门款 1 组、高端款 5 组） */
  onboardProfiles: number;
  /** 是否有 RGB（G304 没有，GPW 有） */
  hasRgb: boolean;
  connection: ConnectionType;
}

export interface DpiState {
  /** 每档 DPI，如 [400, 800, 1600, 3200] */
  presets: number[];
  /** 当前激活的是第几档 index */
  activeIndex: number;
  /** 当前传感器实际 DPI（高亮显示用） */
  currentDpi: number;
}

export interface DeviceSession {
  device: HIDDeviceLike;
  info: SupportedDevice;
  dpi: DpiState;
  battery?: number;
}

export const LOGITECH_VID = 0x046d;

/** WebHID 是否可用：只要 Chrome / Edge 89+ 且 https/localhost */
export function isWebHIDSupported(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator;
}
