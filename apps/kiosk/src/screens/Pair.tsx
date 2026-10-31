// Setting up: a grown-up makes a code in the parent app (Settings, Kiosk) and types it here once.
import { useState } from 'preact/hooks';
import { api, stored } from '../api';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

export function Pair({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const send = async (c: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ token: string }>('POST', '/pair', { code: c });
      stored.setToken(r.token);
      onPaired();
    } catch (err) {
      setError((err as Error).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  const press = (k: string) => {
    if (busy) return;
    if (k === 'del') return setCode((c) => c.slice(0, -1));
    const next = (code + k).slice(0, 6);
    setCode(next);
    if (next.length === 6) void send(next);
  };

  return (
    <main class="pair" aria-label="Set up this kiosk">
      <div class="pair-text">
        <h1>Set up this kiosk</h1>
        <p>A grown-up opens Family time on their phone, goes to Settings, then Kiosk, and taps Set up the kiosk. Type the six numbers it shows.</p>
        <p class="pair-code" aria-label={`${code.length} of 6 numbers typed`}>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} class={i < code.length ? 'on' : ''}>
              {code[i] ?? ''}
            </span>
          ))}
        </p>
        {error ? (
          <p class="pair-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div class="keypad" role="group" aria-label="Numbers">
        {KEYS.map((k) =>
          k ? (
            <button key={k} type="button" class="key" aria-label={k === 'del' ? 'Delete' : k} onClick={() => press(k)}>
              {k === 'del' ? 'Delete' : k}
            </button>
          ) : (
            <span key="gap" />
          ),
        )}
      </div>
    </main>
  );
}
