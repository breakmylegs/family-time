// The household day as a timetable strip, with a Now marker and the pause overlay. Every time
// comes from the server; the app only places the blocks along the bar.
import type { ChildStatus, DayBlock } from '@family-time/schemas';

const HOUR = 3_600_000;

/** The stretch of the day worth showing: from the end of school (or the block now is in) to an hour into bed. */
export function railWindow(blocks: DayBlock[], now: number): { start: number; end: number } | undefined {
  if (!blocks.length) return undefined;
  const schoolEnds = blocks.filter((b) => b.type === 'school').map((b) => Date.parse(b.end));
  const lastSchool = schoolEnds.length ? Math.max(...schoolEnds) : undefined;
  const containing = blocks.find((b) => Date.parse(b.start) <= now && now < Date.parse(b.end));
  let start: number;
  if (lastSchool !== undefined && now >= lastSchool) start = lastSchool;
  else start = containing ? Date.parse(containing.start) : Date.parse(blocks[0]!.start);
  const bed = blocks.find((b) => b.type === 'bed' && Date.parse(b.start) >= start);
  const last = Math.max(...blocks.map((b) => Date.parse(b.end)));
  let end = bed ? Math.min(Date.parse(bed.start) + HOUR, Date.parse(bed.end)) : last;
  end = Math.min(Math.max(end, now + HOUR / 2), last);
  return end > start ? { start, end } : undefined;
}

export function Rail({ status }: { status: ChildStatus }) {
  const now = Date.parse(status.at);
  const w = railWindow(status.day, now);
  if (!w) return null;
  const span = w.end - w.start;
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - w.start) / span) * 100));
  const shown = status.day.filter((b) => Date.parse(b.end) > w.start && Date.parse(b.start) < w.end);

  // Labels: the first block and every block that is not free time, never crowding the one before.
  // The last one near the end sits right-aligned, as Bed does in the mock.
  const labels: { b: DayBlock; left: number; right: boolean }[] = [];
  shown.forEach((b, i) => {
    const left = pct(Date.parse(b.start));
    const prev = labels[labels.length - 1];
    const right = i === shown.length - 1 && left > 70;
    if (prev && b.type === 'free') return;
    if (prev && (right ? 100 - prev.left < 27 : left - prev.left < 18)) return;
    labels.push({ b, left, right });
  });

  const pause = status.pause;
  const bedStart = status.day.find((b) => b.type === 'bed' && Date.parse(b.start) > now)?.start;
  const pauseEnd = pause ? (pause.until ? Date.parse(pause.until) : bedStart ? Date.parse(bedStart) : w.end) : now;
  const pauseWidth = Math.max(1.5, pct(pauseEnd) - pct(now));

  const spoken = `Today's rhythm. ${shown.map((b) => `${b.label} ${b.startLabel} to ${b.endLabel}`).join(', ')}.${pause ? ' Everything is paused now.' : ''}`;

  return (
    <div className="rail" role="img" aria-label={spoken}>
      <div className="rail-bar" aria-hidden="true">
        {shown.map((b, i) => {
          const left = pct(Date.parse(b.start));
          const width = pct(Date.parse(b.end)) - left;
          const lastOne = i === shown.length - 1;
          return <i key={b.start} className={`seg-r ${b.type}`} style={{ left: `${left}%`, width: lastOne ? `${width}%` : `calc(${width}% - 2px)` }} />;
        })}
        <i className="rail-pause" data-on={Boolean(pause)} style={{ left: `${pct(now)}%`, width: `${pauseWidth}%` }} />
        <i className="rail-now" style={{ left: `${pct(now)}%` }}>
          <span>Now</span>
        </i>
      </div>
      <div className="rail-labels" aria-hidden="true">
        {labels.map(({ b, left, right }) => {
          return (
            <span key={b.start} style={right ? { right: 0, textAlign: 'right' } : { left: `${left}%` }}>
              <b>{b.label}</b>
              <span className="tnum">{b.startLabel}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
