import { registerSW } from 'virtual:pwa-register';
import { toast } from './ui/fx';
import { icons } from './ui/icons';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const canInstall = () => !!deferred;

export async function promptInstall() {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  return outcome === 'accepted';
}

export function initPwa() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    toast('ArtifyMe is on your home screen.', { icon: icons.check });
  });
  if (!('serviceWorker' in navigator)) return;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast('A new edition of ArtifyMe is ready.', { icon: icons.sparkle, duration: 12000, action: { label: 'Reload', run: () => update(true) } });
    },
    onOfflineReady() {
      toast('Ready to paint offline.', { icon: icons.check });
    },
  });
}
