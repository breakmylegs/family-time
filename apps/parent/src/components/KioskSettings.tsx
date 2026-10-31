// Settings, Kiosk (ADR 0015): the family's kiosk tablets, setting a new one up with a code, and
// removing one, which stops it at once.
import type { KioskDevice, KioskPairing } from '@family-time/schemas';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { HelpButton } from '../help/HelpButton';
import { Icon } from '../icons';
import { useToast } from '../toast';
import { Sheet } from './Sheet';

const seen = (iso: string | null) =>
  iso ? `Last checked in ${new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}` : 'Not checked in yet';

export function KioskSettings() {
  const toast = useToast();
  const [kiosks, setKiosks] = useState<KioskDevice[]>();
  const [pairing, setPairing] = useState<{ code: KioskPairing; from: HTMLElement | null }>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setKiosks(await api<KioskDevice[]>('GET', '/api/kiosks'));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const setUp = async (from: HTMLElement) => {
    setError(undefined);
    try {
      const code = await api<KioskPairing>('POST', '/api/kiosks/pairing', { label: 'Kiosk' });
      setPairing({ code, from });
      setOpen(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const remove = async (k: KioskDevice) => {
    try {
      await api('DELETE', `/api/kiosks/${k.id}`);
      toast(`Removed. That kiosk needs a new code to work again.`);
      void load();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <section className="sec" aria-labelledby="kiosk">
      <div className="sec-head">
        <h2 id="kiosk">Kiosk</h2>
        <HelpButton topic="the-kiosk" label="The kiosk tablet" />
      </div>
      <div className="group">
        {(kiosks ?? []).map((k) => (
          <div key={k.id} className="row">
            <span className="row-icon">
              <Icon name="device" />
            </span>
            <span className="row-text">
              {k.label}
              <small>{seen(k.lastSeen)}</small>
            </span>
            <span className="row-end">
              <button type="button" className="btn btn-quiet row-btn" aria-label={`Remove ${k.label}`} onClick={() => void remove(k)}>
                Remove
              </button>
            </span>
          </div>
        ))}
        {kiosks && !kiosks.length ? <p className="empty">No kiosk yet. Set one up on the tablet your child uses.</p> : null}
        {error ? (
          <p className="empty" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={(e) => void setUp(e.currentTarget)}>
        <Icon name="plus" />
        Set up the kiosk
      </button>
      {pairing ? (
        <Sheet
          open={open}
          onClose={() => {
            setOpen(false);
            setTimeout(() => {
              setPairing(undefined);
              void load();
            }, 240);
          }}
          title="Set up the kiosk"
          returnFocus={pairing.from}
          sub={`On the tablet, open ${pairing.code.kioskUrl ?? 'the kiosk address from docs/setup/kiosk.md'} and type this code. It works once, until ${pairing.code.expires}.`}
        >
          <p className="pair-code tnum" aria-label={`Code ${pairing.code.code.split('').join(' ')}`}>
            {pairing.code.code}
          </p>
        </Sheet>
      ) : null}
    </section>
  );
}
