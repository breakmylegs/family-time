// Alerts on this phone. Permission is asked only after a tap on "Turn on alerts", and on iPhone
// only in the app added to the Home Screen: Safari itself cannot receive web push.
import { api } from './api';

export type AlertState = 'unsupported' | 'install-first' | 'off' | 'on' | 'denied';

function standalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export async function alertState(): Promise<AlertState> {
  if (isIos() && !standalone()) return 'install-first';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub || Notification.permission !== 'granted') return 'off';
  // The browser may still hold a subscription the server has dropped (after failures, or a new
  // install). Only what the server knows gets alerts, so make sure it knows this one.
  try {
    const { endpoints } = await api<{ endpoints: string[] }>('GET', '/api/push/subscriptions/mine');
    if (!endpoints.includes(sub.endpoint)) await register(sub);
    return 'on';
  } catch {
    return 'off';
  }
}

async function register(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('POST', '/api/push/subscriptions', { endpoint: json.endpoint, keys: json.keys });
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Asks for permission (this must run straight from the tap), subscribes, and tells the server. */
export async function turnOnAlerts(): Promise<AlertState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const { publicKey } = await api<{ publicKey: string }>('GET', '/api/push/key');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await register(sub);
  return 'on';
}

export async function turnOffAlerts(): Promise<AlertState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('DELETE', '/api/push/subscriptions', { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  return 'off';
}

/** The worker only handles push and the tap on an alert. It caches nothing, so a deploy is never stale. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // Refused outside https and localhost; alerts then say they are not available.
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
}
