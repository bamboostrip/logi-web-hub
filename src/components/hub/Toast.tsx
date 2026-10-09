import { useHub, type NoticeKind } from '../../store/deviceStore';
import { t } from '../../i18n';

const KIND_STYLE: Record<NoticeKind, { bar: string; icon: string }> = {
  ok: { bar: '#22c55e', icon: '✓' },
  err: { bar: '#ef4444', icon: '✕' },
  info: { bar: 'var(--accent)', icon: 'ℹ' },
};

/** 全局操作反馈 toast：写入成功/失败即时可见，自动消失 */
export default function ToastStack() {
  const notices = useHub((s) => s.notices);
  const dismiss = useHub((s) => s.dismissNotice);
  const locale = useHub((s) => s.locale);
  if (notices.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[90] flex w-[320px] flex-col gap-2">
      {notices.map((n) => {
        const st = KIND_STYLE[n.kind];
        return (
          <div
            key={n.id}
            className="toast-in pointer-events-auto flex items-center gap-2.5 overflow-hidden rounded-xl py-2.5 pl-3 pr-2"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--card-border)',
              boxShadow: 'var(--shadow-card)',
              backdropFilter: 'blur(18px)',
            }}
            role="status"
          >
            <span
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-black text-white"
              style={{ background: st.bar }}
            >
              {st.icon}
            </span>
            <span className="min-w-0 flex-1 text-xs leading-4" style={{ color: 'var(--text)' }}>
              {n.text}
            </span>
            <button
              onClick={() => dismiss(n.id)}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-xs opacity-50 hover:opacity-100"
              style={{ color: 'var(--text-2)' }}
              aria-label={t(locale, 'common.close')}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
