import type { SupportedDevice } from './types';

/**
 * 支持设备表：
 * - PID 以 libratbag `data/devices/*.device` 为准（2026-10-09 从上游 clone，
 *   见 `D:\AllCode\react\upstream-refs\libratbag`，libratbag 为 MIT 许可），并与 Solaar
 *   `lib/logitech_receiver/descriptors.py`（GPLv2，仅语义参考）交叉核对（c086/c087/c08b/c08d/c090/c091 一致）；
 * - G304 c53f 接收器 / GPW c539 接收器为本项目真机实测，libratbag 未收录，予以保留；
 * - DPI 范围/板载组数拿不准的标“待实测”，连接成功后实测（DPI 表/0x8100）自动回填覆盖；
 * - 蓝牙模式走不了 HID++，一律不支持（G604 的 b024 仅作注记，不进表）。
 */
export const SUPPORTED_DEVICES: SupportedDevice[] = [
  {
    name: 'G Pro Wireless (Gen1)',
    vendorId: 0x046d,
    productIds: [
      0xc088, // 有线（libratbag）
      0x4079, // 直连/model（libratbag）
      0xc539, // Lightspeed 接收器（本项目真机实测）
    ],
    dpiMin: 100,
    dpiMax: 25600,
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 5, // G HUB 板载 5 组
    hasRgb: true,
    connection: 'unknown',
  },
  {
    name: 'G Pro X Superlight',
    vendorId: 0x046d,
    productIds: [
      0x4093, // 直连（libratbag）
      0xc094, // 接收器（libratbag）
    ],
    dpiMin: 100,
    dpiMax: 25600, // HERO 25K，待实测
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 5, // 待实测，以 0x8100 为准
    hasRgb: false, // 超轻无 RGB
    connection: 'unknown',
  },
  {
    name: 'G304 / G305 Lightspeed',
    vendorId: 0x046d,
    productIds: [
      0xc53f, // Lightspeed 接收器（本项目真机实测）
      0x4074, // 有线直连 / 固件 model id（实测 + libratbag g305 一致）
    ],
    dpiMin: 200,
    dpiMax: 12000,
    dpiStep: 50,
    dpiSlots: 4,
    onboardProfiles: 1, // 入门款单组（mock + 真机 0x8100 f0 已验证）
    hasRgb: false, // 只有 DPI 指示灯，无 RGB
    connection: 'unknown',
  },
  {
    name: 'G102 / G203',
    vendorId: 0x046d,
    productIds: [
      0xc084, // libratbag
      0xc092, // libratbag
      0xc09d, // libratbag
    ],
    dpiMin: 200,
    dpiMax: 8000, // Mercury 传感器，待实测
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 1, // 入门款暂按单组，待实测
    hasRgb: true, // G203 LIGHTSYNC（G102 无灯，实测灯效探测会纠正显示）
    connection: 'unknown',
  },
  {
    name: 'G502 HERO',
    vendorId: 0x046d,
    productIds: [
      0xc08b, // 有线（libratbag + Solaar 一致）
    ],
    dpiMin: 100,
    dpiMax: 16000, // HERO 16K，待实测
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 5, // 待实测，以 0x8100 为准
    hasRgb: true,
    connection: 'unknown',
  },
  {
    name: 'G502 Lightspeed',
    vendorId: 0x046d,
    productIds: [
      0x407f, // 直连（libratbag）
      0xc08d, // 接收器（libratbag + Solaar 一致）
    ],
    dpiMin: 100,
    dpiMax: 16000, // HERO 16K，待实测
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 5, // 待实测，以 0x8100 为准
    hasRgb: true,
    connection: 'unknown',
  },
  {
    name: 'G502 X Series',
    vendorId: 0x046d,
    productIds: [
      0xc099, // X 有线（libratbag）
      0xc098, // X 无线接收器（libratbag）
      0x409f, // X 无线直连（libratbag）
      0x4099, // X Plus 直连（libratbag）
      0xc095, // X Plus 接收器（libratbag）
    ],
    dpiMin: 100,
    dpiMax: 25600, // HERO 25K，待实测
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 5, // 待实测，以 0x8100 为准
    hasRgb: true,
    connection: 'unknown',
  },
  {
    name: 'G703',
    vendorId: 0x046d,
    productIds: [
      0xc087, // （libratbag + Solaar 一致）
      0x4070, // 直连（libratbag）
    ],
    dpiMin: 200,
    dpiMax: 12000, // PMW3366 世代，待实测
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 5, // 待实测，以 0x8100 为准
    hasRgb: true,
    connection: 'unknown',
  },
  {
    name: 'G703 HERO',
    vendorId: 0x046d,
    productIds: [
      0x4086, // 直连（libratbag）
      0xc090, // （libratbag + Solaar 一致）
    ],
    dpiMin: 100,
    dpiMax: 16000, // HERO 16K，待实测
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 5, // 待实测，以 0x8100 为准
    hasRgb: true,
    connection: 'unknown',
  },
  {
    name: 'G903',
    vendorId: 0x046d,
    productIds: [
      0xc086, // （libratbag + Solaar 一致）
      0x4067, // 直连（libratbag）
    ],
    dpiMin: 200,
    dpiMax: 12000, // PMW3366 世代，待实测
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 5, // 待实测，以 0x8100 为准
    hasRgb: true,
    connection: 'unknown',
  },
  {
    name: 'G903 HERO',
    vendorId: 0x046d,
    productIds: [
      0xc091, // （libratbag + Solaar 一致）
      0x4087, // 直连（libratbag）
    ],
    dpiMin: 100,
    dpiMax: 16000, // HERO 16K，待实测
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 5, // 待实测，以 0x8100 为准
    hasRgb: true,
    connection: 'unknown',
  },
  {
    name: 'G303 Shroud Edition',
    vendorId: 0x046d,
    productIds: [
      0xc097, // （libratbag）
    ],
    dpiMin: 100,
    dpiMax: 25600, // HERO 25K，待实测
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 5, // 待实测，以 0x8100 为准
    hasRgb: true,
    connection: 'unknown',
  },
  {
    name: 'G604',
    vendorId: 0x046d,
    productIds: [
      0x4085, // 直连（libratbag；b024 为蓝牙，不进表）
    ],
    dpiMin: 100,
    dpiMax: 16000, // HERO 16K，待实测
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 5, // 待实测，以 0x8100 为准
    hasRgb: false, // 待实测，灯效探测会纠正显示
    connection: 'unknown',
  },
  {
    name: 'G403 HERO',
    vendorId: 0x046d,
    productIds: [
      0xc08f, // （libratbag）
    ],
    dpiMin: 100,
    dpiMax: 16000, // HERO 16K，待实测
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 5, // 待实测，以 0x8100 为准
    hasRgb: true,
    connection: 'unknown',
  },
];

/** 默认 DPI 预设（出厂值对照，无设备/读不到时展示用） */
export const DEFAULT_PRESETS: Record<string, number[]> = {
  'G Pro Wireless (Gen1)': [400, 800, 1600, 3200, 6400],
  'G Pro X Superlight': [400, 800, 1600, 3200, 6400],
  'G304 / G305 Lightspeed': [400, 800, 1600, 3200],
  'G102 / G203': [400, 800, 1600, 3200, 6400],
  'G502 HERO': [400, 800, 1600, 3200, 6400],
  'G502 Lightspeed': [400, 800, 1600, 3200, 6400],
  'G502 X Series': [400, 800, 1600, 3200, 6400],
  'G703': [400, 800, 1600, 3200, 6400],
  'G703 HERO': [400, 800, 1600, 3200, 6400],
  'G903': [400, 800, 1600, 3200, 6400],
  'G903 HERO': [400, 800, 1600, 3200, 6400],
  'G303 Shroud Edition': [400, 800, 1600, 3200, 6400],
  'G604': [400, 800, 1600, 3200, 6400],
  'G403 HERO': [400, 800, 1600, 3200, 6400],
};

/**
 * HID++ DEVICE_NAME 实测值 → 型号档案（G304 实测名 "G304 Lightspeed Wireless Gaming Mouse"）。
 * 顺序敏感：具体型号在前，家族兜底在后。
 */
const HID_NAME_MATCHERS: Array<{ re: RegExp; profile: string }> = [
  { re: /superlight/i, profile: 'G Pro X Superlight' },
  { re: /shroud|g\s*303\b/i, profile: 'G303 Shroud Edition' },
  { re: /g\s*502\s*x\s*plus/i, profile: 'G502 X Series' },
  { re: /g\s*502\s*x/i, profile: 'G502 X Series' },
  { re: /g\s*502.*lightspeed|g\s*502.*wireless/i, profile: 'G502 Lightspeed' },
  { re: /g\s*502\b/i, profile: 'G502 HERO' },
  { re: /g\s*703\s*hero/i, profile: 'G703 HERO' },
  { re: /g\s*703\b/i, profile: 'G703' },
  { re: /g\s*903\s*hero/i, profile: 'G903 HERO' },
  { re: /g\s*903\b/i, profile: 'G903' },
  { re: /g\s*604\b/i, profile: 'G604' },
  { re: /g\s*403\b/i, profile: 'G403 HERO' },
  { re: /g\s*pro\s*wireless/i, profile: 'G Pro Wireless (Gen1)' },
  { re: /g\s*pro\b/i, profile: 'G Pro Wireless (Gen1)' },
  { re: /\bg\s*30[45]/i, profile: 'G304 / G305 Lightspeed' },
  { re: /\bg\s*102\b|\bg\s*203\b/i, profile: 'G102 / G203' },
];

/** 用 HID++ 读到的设备名匹配型号档案（识别优先级最高） */
export function matchByHidName(hidName: string): SupportedDevice | null {
  for (const m of HID_NAME_MATCHERS) {
    if (m.re.test(hidName)) {
      const base = SUPPORTED_DEVICES.find((d) => d.name === m.profile);
      if (base) return { ...base, name: hidName };
    }
  }
  return null;
}

/** HID 名/档案名 → 型号家族 key（板载槽缓存按家族归一，同款有线/接收器共享） */
export function canonicalProfileKey(name: string | null | undefined): string {
  if (!name) return 'default';
  for (const m of HID_NAME_MATCHERS) {
    if (m.re.test(name)) return m.profile;
  }
  if (DEFAULT_PRESETS[name]) return name;
  return name;
}

/** 名称（HID++ 名或档名）→ 默认 DPI 预设 */
export function defaultPresetsForName(name: string | null | undefined): number[] | undefined {
  if (!name) return undefined;
  if (DEFAULT_PRESETS[name]) return DEFAULT_PRESETS[name];
  for (const m of HID_NAME_MATCHERS) {
    if (m.re.test(name)) return DEFAULT_PRESETS[m.profile];
  }
  return undefined;
}

export function matchDevice(vendorId: number, productId: number) {
  return SUPPORTED_DEVICES.find(
    (d) => d.vendorId === vendorId && d.productIds.includes(productId),
  );
}

/**
 * 通用档案：未知型号使用。罗技未知型号按产品名字符串展示，
 * DPI 范围取保守通用值，自检页实测回填；非罗技设备同样放行连接。
 * onboardProfiles 保守按 1 组展示（一定存在），真机 0x8100 读到更多后再上调。
 */
export function genericDevice(vendorId: number, productId: number, productName?: string): SupportedDevice {
  const pid = `0x${productId.toString(16)}`;
  const isLogi = vendorId === 0x046d;
  const clean = (productName ?? '').trim();
  return {
    name: clean || (isLogi ? `罗技未知型号 (${pid})` : `未知 HID 设备 (${pid})`),
    vendorId,
    productIds: [productId],
    dpiMin: 100,
    dpiMax: 16000,
    dpiStep: 50,
    dpiSlots: 5,
    onboardProfiles: 1,
    hasRgb: false,
    connection: 'unknown',
  };
}
