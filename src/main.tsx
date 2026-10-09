import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function boot() {
  // DEV-only：?mockhid=1 用真机抓包回放 WebHID，无硬件也能全流程自测；失败不阻塞正常启动
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('mockhid')) {
    try {
      const { installDevMock } = await import('./core/hid/devMock')
      installDevMock()
    } catch (e) {
      console.warn('[devMock] 安装失败，使用真实 WebHID：', e)
    }
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
