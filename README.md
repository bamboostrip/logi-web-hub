# Logi Web Hub · 网页罗技鼠标控制台

[English](README.en.md) · [在线体验](https://logi-hub.famlife.top)

> 直接点上面的在线体验链接就能用（需 Chrome / Edge，鼠标接有线或 2.4G 接收器）。

免驱动、免安装的罗技游戏鼠标网页控制台：浏览器直连鼠标（WebHID + HID++），读 DPI / 电量 / 回报率 / 灯效并真机写入。首批以 **G304 / G305 Lightspeed、G Pro 系列、G502 / G703 / G903 系列**等 14 款游戏鼠为目标（见 `src/core/hid/devices.ts`）。

## 功能一览

| 功能 | 真机写入 | 说明 |
|---|---|---|
| DPI 设置 | ✅ `0x2201`（只写当前档） | 多档位为本地软件预设，点卡片即切换；档位颜色可对照鼠标实物指示灯（仅本地） |
| 回报率 | ✅ `0x8060` / `0x8061` | 板载生效时自动切主机接管再写（Solaar #1040 方案），失败报设备原话 |
| 灯效 | ✅ `0x8070`（有灯机型） | 无灯机型（如 G304）自动隐藏 |
| 电量 | 只读 | `0x1004` → `0x1000` → `0x1001` → 1.0 寄存器，多路回退 |
| 改键 | 有则写 `0x1B04` | G304/G305 硬件无此特性（Solaar #850 定论），用主机宏（本地） |
| 抬升距离 LOD | 有则写 `0x2202` | G304 无此特性，保持本地 |
| 休眠 / 直线修正 | 本地 | 鼠标无公开 HID++ 特性，只记浏览器 |
| 配置管理 | JSON 导入导出 | 板载槽快照 + 按键宏本地备份 |
| 双语 | 中 / EN | 顶栏一键切换，偏好存本地 |

## 环境要求

- **Chrome / Edge 89+**（WebHID），页面需 `https` 或 `localhost`（`file://` 不可用）。
- 鼠标用**有线直连或 2.4G 接收器**，蓝牙模式走不了 HID++。
- 连接前退出 **G HUB / Solaar**（会抢接收器通道）；鼠标休眠时动一下再自检。

## 快速开始

```bash
pnpm install
pnpm dev      # 开发 http://localhost:5173
pnpm build    # 构建（tsc + vite）
pnpm preview  # 预览生产包
```

无硬件联调：开发模式打开 `http://localhost:5173/?mockhid=1`，用 G304 真机抓包回放全流程（见 `src/core/hid/devMock.ts`）。

## 连接与排查

1. 首页点「连接设备」，在浏览器授权框里选罗技设备（接收器只有一个 HID++ 条目）。
2. 自动跑完 HID++ 自检：环境 → 通道探测 → Feature 存在性 → DPI / 电量 / 回报率 / 按键实读 → 总结。
3. 某项未读出：打开自检页「查看详情（开发人员）」，把对应步骤的 raw 报文贴到 issue 即可定位（不同固件回包布局有差异）。

## 自托管部署

```bash
docker compose up -d --build   # http://服务器IP:8080
```

说明：`docker-compose.yaml` 用多阶段构建（Node 构建 → `nginx:alpine` 静态托管，含 SPA 回退 + gzip）。
**WebHID 必须跑在安全上下文**，公网域名请在前面再套一层 TLS 终结（如 Nginx Proxy Manager / Caddy / Traefik 反代到 8080，
证书指向 `logi-hub.famlife.top`），否则浏览器拒绝授权。

## 技术与致谢

- 协议语义参考 [Solaar](https://github.com/pwr-Solaar/Solaar)（GPLv2，仅参考语义、代码全部重写）与 [OpenLogi 文档](https://openlogi.org/hidpp/features)；设备 PID/DPI 数据来自 [libratbag](https://github.com/libratbag/libratbag)（MIT，已注来源）。

## 许可证

MIT（见 `LICENSE`）。
