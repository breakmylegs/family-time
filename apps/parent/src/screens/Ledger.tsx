// The owner's Ledger screen (brief Part 7): every change to time, money and points, newest first.
// On the Besu ledger each one shows its place on the family's chain: the block it is in and its
// transaction, or that it is still on its way. Read only: mistakes are put right on Family.
import type { ChainLedger } from '@family-time/schemas';
import { useFetched } from '../economy/data';
import { Icon } from '../icons';
import { navigate } from '../router';

const STATUS: Record<ChainLedger['entries'][number]['status'], string> = {
  recorded: '',
  waiting: 'On its way to the chain',
  sent: 'Sent, waiting for the next block',
  confirmed: 'On the chain',
  refused: 'Refused by the chain',
};

/** "0x1a2b…9f0e": enough to tell two apart, short enough for a phone. */
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

export function Ledger() {
  const { data, error, reload } = useFetched<ChainLedger>('/api/ledger/entries');
  const besu = data?.adapter === 'besu';
  const q = data?.queue;

  return (
    <main className="screen" aria-label="Ledger">
      <div className="large">
        <button type="button" className="back" onClick={() => navigate('/settings')}>
          <Icon name="left" />
          Settings
        </button>
        <h1>Ledger</h1>
        <p>{besu ? "Every change to time, money and points, and where each one is on the family's chain." : 'Every change to time, money and points, in order. Each one is sealed to the one before.'}</p>
      </div>

      {error && !data ? (
        <div className="sec">
          <p className="empty-large" role="alert">
            {error}
          </p>
          <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={() => void reload()}>
            Try again
          </button>
        </div>
      ) : null}
      {!data && !error ? <p className="empty-large">Loading.</p> : null}

      {besu ? (
        <section className="sec" aria-labelledby="chain-head">
          <div className="sec-head">
            <h2 id="chain-head">The chain</h2>
          </div>
          <div className="group">
            {data.contract ? (
              <>
                <div className="row">
                  <span className="row-text">
                    Contract
                    <small className="mono">
                      {short(data.contract.address)}, version {data.contract.version}
                    </small>
                  </span>
                </div>
                <div className="row">
                  <span className="row-text">
                    Read up to
                    <small className="tnum">Block {data.contract.indexedBlock ?? data.contract.deployedBlock}</small>
                  </span>
                </div>
                {q ? (
                  <div className="row">
                    <span className="row-text">
                      Entries
                      <small className="tnum">
                        {q.mined} on the chain{q.pending + q.sent ? `, ${q.pending + q.sent} on their way` : ''}
                      </small>
                    </span>
                  </div>
                ) : null}
                {q?.failed ? (
                  <p className="sh-error ledger-warning" role="alert">
                    The chain refused an entry, so nothing more is being written to it. Run ./scripts/ft.sh ledger-check on the server to see why.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="empty">No contract yet. Run ./scripts/ft.sh ledger-deploy on the server to start the chain.</p>
            )}
          </div>
        </section>
      ) : null}

      {data ? (
        <section className="sec" aria-labelledby="entries-head">
          <div className="sec-head">
            <h2 id="entries-head">Entries</h2>
          </div>
          <ol className="group ledger chain">
            {data.entries.map((e) => (
              <li key={e.seq}>
                <span>
                  {e.reason}
                  <span className="when">
                    {e.childName}, {e.when}
                  </span>
                  {besu ? (
                    <span className={`chain-status ${e.status}`}>
                      {e.status === 'confirmed' && e.blockNumber ? `Block ${e.blockNumber}` : STATUS[e.status]}
                      {e.txHash ? <span className="mono"> {short(e.txHash)}</span> : null}
                    </span>
                  ) : null}
                </span>
                <span className="chg tnum">{e.change}</span>
              </li>
            ))}
            {!data.entries.length ? <li className="empty">Nothing yet.</li> : null}
          </ol>
        </section>
      ) : null}
    </main>
  );
}
