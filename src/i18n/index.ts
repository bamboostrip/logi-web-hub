import { en } from './en';
import { zh, type I18nKey } from './zh';

export type { I18nKey };
export type Locale = 'zh' | 'en';

export const LOCALE_KEY = 'logi-web-hub:locale';

/** 生效语言：本地偏好 > 浏览器语言 > 中文 */
export function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* ignore */
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en')) {
    return 'en';
  }
  return 'zh';
}

export function persistLocale(l: Locale) {
  try {
    localStorage.setItem(LOCALE_KEY, l);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
  }
}

/** 取文案并插值 `{name}`；英文缺键回退中文，再缺回退键名（永不空白） */
export function t(locale: Locale, key: I18nKey, vars?: Record<string, string | number>): string {
  const dict = locale === 'en' ? en : zh;
  const raw = dict[key] ?? zh[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : m,
  );
}
