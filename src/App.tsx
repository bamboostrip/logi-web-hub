import { useEffect } from 'react';
import ShaderBackground from './components/fx/ShaderBackground';
import TopBar from './components/hub/TopBar';
import SideBar from './components/hub/SideBar';
import DeviceCards from './components/hub/DeviceCards';
import KeymapPanel from './components/hub/KeymapPanel';
import DpiPanel from './components/hub/DpiPanel';
import DiagPanel from './components/hub/DiagPanel';
import PerformancePanel from './components/hub/PerformancePanel';
import ParamsPanel from './components/hub/ParamsPanel';
import ProfilesPanel from './components/hub/ProfilesPanel';
import { OtherPanel, SettingsDrawer } from './components/hub/OtherPanel';
import ToastStack from './components/hub/Toast';
import { useHub } from './store/deviceStore';

function MainView() {
  const tab = useHub((s) => s.tab);
  const connected = useHub((s) => s.connected);

  if (!connected || tab === 'home') return <DeviceCards />;

  switch (tab) {
    case 'diag':
      return <DiagPanel />;
    case 'keymap':
      return <KeymapPanel />;
    case 'dpi':
      return <DpiPanel />;
    case 'performance':
      return <PerformancePanel />;
    case 'params':
      return <ParamsPanel />;
    case 'profiles':
      return <ProfilesPanel />;
    case 'other':
      return <OtherPanel />;
    default:
      return <DiagPanel />;
  }
}

export default function App() {
  const connected = useHub((s) => s.connected);
  const autoConnect = useHub((s) => s.autoConnect);

  // 已授权过的罗技 HID++ 设备：加载时静默自动连接（免再点授权框）
  useEffect(() => {
    void autoConnect();
  }, [autoConnect]);

  return (
    <div className="relative min-h-full">
      <ShaderBackground />
      <div className="relative flex min-h-screen flex-col">
        <TopBar />
        <div className="flex flex-1 items-stretch">
          {connected && <SideBar />}
          <main className="min-w-0 flex-1">
            <MainView />
          </main>
        </div>
      </div>
      <SettingsDrawer />
      <ToastStack />
    </div>
  );
}
