// Settings, Kiosk (ADR 0015): the family's kiosk tablets, setting a new one up with a code, and
// removing one, which stops it at once.
import type { KioskDevice, KioskPairing, KioskPinChild } from '@family-time/schemas';
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
  const [pins, setPins] = useState<KioskPinChild[]>([]);
  const [pinFor, setPinFor] = useState<{ child: KioskPinChild; from: HTMLElement | null }>();

  const load = useCallback(async () => {
    try {
      setKiosks(await api<KioskDevice[]>('GET', '/api/kiosks'));
      setPins(await api<KioskPinChild[]>('GET', '/api/kiosks/pins'));
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
      // Numbered, so two tablets never look the same in the list.
      const code = await api<KioskPairing>('POST', '/api/kiosks/pairing', { label: `Kiosk ${(kiosks?.length ?? 0) + 1}` });
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
              <button type="button" className="btn btn-quiet row-btn" aria-label={`Remove this tablet: ${k.label}, ${seen(k.lastSeen)}`} onClick={() => void remove(k)}>
                Remove this tablet
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
      {pins.length > 1 ? (
        <>
          <h3 className="sub-head">PINs for brothers and sisters</h3>
          <div className="group">
            {pins.map((c) => (
              <div key={c.id} className="row">
                <span className="row-text">
                  {c.name}
                  <small>{c.pin ? 'Asks for a PIN on the kiosk' : 'No PIN: opens straight to their home'}</small>
                </span>
                <span className="row-end">
                  <button type="button" className="btn btn-quiet row-btn" aria-label={`${c.pin ? 'Change PIN' : 'Set a PIN'} for ${c.name}`} onClick={(e) => setPinFor({ child: c, from: e.currentTarget })}>
                    {c.pin ? 'Change PIN' : 'Set a PIN'}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
      <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={(e) => void setUp(e.currentTarget)}>
        <Icon name="plus" />
        Set up the kiosk
      </button>
      {pinFor ? (
        <PinSheet
          child={pinFor.child}
          from={pinFor.from}
          onClose={() => setPinFor(undefined)}
          onSaved={(words) => {
            setPinFor(undefined);
            toast(words);
            void load();
          }}
        />
      ) : null}
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
          sub={`Type this code on the kiosk tablet. It works once, until ${pairing.code.expires}.${pairing.code.kioskUrl ? ` If the tablet isn't showing the code screen, open ${pairing.code.kioskUrl}.` : ''}`}
        >
          <p className="pair-code tnum">
            <span aria-hidden="true">{pairing.code.code}</span>
            <span className="sr">{`Code ${pairing.code.code.split('').join(' ')}`}</span>
          </p>
        </Sheet>
      ) : null}
    </section>
  );
}

/** Four numbers, chosen with the child. Only the numbers' hash is kept. */
function PinSheet({ child, from, onClose, onSaved }: { child: KioskPinChild; from: HTMLElement | null; onClose: () => void; onSaved: (words: string) => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const save = async (value: string | null) => {
    try {
      await api('PUT', `/api/kiosks/pins/${child.id}`, { pin: value });
      onSaved(value ? `${child.name} types the PIN on the kiosk from now on.` : `${child.name}'s PIN is off. Tapping ${child.name} on the kiosk now opens their home straight away.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${child.name}'s kiosk PIN`}
      returnFocus={from}
      error={error}
      sub="For brothers and sisters sharing the tablet: each one types their own PIN before their home opens. Choose the four numbers together."
      footer={
        child.pin ? (
          <button type="button" className="btn btn-quiet" onClick={() => void save(null)}>
            Turn off {child.name}'s PIN
          </button>
        ) : undefined
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{4}$/.test(pin)) void save(pin);
          else setError('Type four numbers to save the PIN.');
        }}
      >
        <label htmlFor="kiosk-pin">Four numbers</label>
        <input id="kiosk-pin" className="field tnum" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        <button type="submit" className="btn btn-primary">
          Save {child.name}'s PIN
        </button>
      </form>
    </Sheet>
  );
}
