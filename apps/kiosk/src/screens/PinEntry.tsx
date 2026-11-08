// A child's kiosk PIN (brief Part 8), when brothers and sisters share the tablet. The numbers show
// as dots. The right numbers open their home on this tablet until it is put down: the screen going
// off, five minutes untouched, or someone tapping Hi to change who is here.
import { useState } from 'preact/hooks';
import { api, stored } from '../api';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'del'];

export function PinEntry({ child, onUnlocked, onBack }: { child: { id: string; name: string }; onUnlocked: () => void; onBack: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const send = async (p: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ ticket: string }>('POST', `/children/${child.id}/unlock`, { pin: p });
      stored.setTicket(child.id, r.ticket);
      onUnlocked();
    } catch (err) {
      setError((err as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  const press = (k: string) => {
    if (busy) return;
    if (k === 'back') return onBack();
    if (k === 'del') return setPin((c) => c.slice(0, -1));
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) void send(next);
  };

  return (
    <main class="pair" aria-label={`${child.name}'s PIN`}>
      <div class="pair-text">
        <h1>Hi {child.name}</h1>
        <p>Type your four numbers.</p>
        <p class="sr" role="status">{`${pin.length} of 4 numbers typed`}</p>
        <p class="pair-code pin" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} class={i < pin.length ? 'on' : ''}>
              {i < pin.length ? '•' : ''}
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
        {KEYS.map((k) => (
          <button key={k} type="button" class="key" aria-label={k === 'del' ? 'Delete' : k === 'back' ? 'Not me' : k} onClick={() => press(k)}>
            {k === 'del' ? 'Delete' : k === 'back' ? 'Not me' : k}
          </button>
        ))}
      </div>
    </main>
  );
}
