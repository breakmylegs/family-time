// What the kiosk calls you (Phase 12): "Mum and Dad" unless your family says something else, like
// "Dad", "Mum and Mum" or "Nana and Grandad". The kiosk uses it in every sentence about you.
import { eitherOf, type KioskWords } from '@family-time/schemas';
import { useState } from 'react';
import { api } from '../api';
import { useFetched } from '../economy/data';
import { useToast } from '../toast';

export function KioskWordsSetting() {
  const toast = useToast();
  const { data, reload } = useFetched<KioskWords>('/api/kiosks/words');
  const [text, setText] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const value = text ?? data.both;
  const changed = value.trim() !== data.both;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const w = await api<KioskWords>('PUT', '/api/kiosks/words', { both: value.trim() });
      setText(undefined);
      toast(`Saved. The kiosk now says "What ${w.both} can see" and "Send to ${w.either}".`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
      void reload();
    }
  };

  return (
    <>
      <h3 className="sub-head">What the kiosk calls you</h3>
      <div className="group">
        <div className="row">
          <span className="row-text">
            <label htmlFor="kiosk-words">What your children call you</label>
            <small>
              For example, Mum and Dad, Dad, Mum and Mum, or Nana and Grandad. The kiosk will say &ldquo;Send to {eitherOf(value.trim() || data.both)}&rdquo;.
            </small>
            <input id="kiosk-words" className="field" style={{ marginTop: 8 }} value={value} maxLength={40} onChange={(e) => setText(e.target.value)} />
          </span>
        </div>
      </div>
      {changed ? (
        <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} disabled={busy || value.trim().length < 2} onClick={() => void save()}>
          {busy ? 'Saving' : 'Save these words'}
        </button>
      ) : null}
    </>
  );
}
