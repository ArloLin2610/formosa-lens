// User settings persisted to localStorage, plus the theme applied to <html>.

import { useCallback, useEffect, useState } from 'react';
import { defaultSettings, loadSettings, saveSettings, type UserSettings } from '@/lib/storage';

export function useSettings(): [UserSettings, (patch: Partial<UserSettings> | ((current: UserSettings) => Partial<UserSettings>)) => void, (next: UserSettings) => void] {
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);

  // Read after mount so the first paint never depends on storage.
  useEffect(() => { setSettings(loadSettings()); setHydrated(true); }, []);
  useEffect(() => { if (hydrated) saveSettings(settings); }, [settings, hydrated]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', settings.theme);
    root.lang = settings.lang === 'zh' ? 'zh-Hant' : 'en';
  }, [settings.theme, settings.lang]);

  const update = useCallback((patch: Partial<UserSettings> | ((current: UserSettings) => Partial<UserSettings>)) => {
    setSettings((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }));
  }, []);
  const replace = useCallback((next: UserSettings) => setSettings(next), []);
  return [settings, update, replace];
}

/** Press "/" anywhere (outside inputs) to focus the search box. */
export function useSlashShortcut(ref: React.RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) { event.preventDefault(); ref.current?.focus(); ref.current?.select(); }
      if (event.key === 'Escape' && target === ref.current) ref.current?.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref]);
}
