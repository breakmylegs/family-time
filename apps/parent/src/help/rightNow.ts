// "Right now" in the help panel: live values for the topics that have them. Everything comes from
// the status the server sent, so the panel and the Control screen always agree.
import type { TopicId } from '@family-time/help-content/content';
import type { ChildStatus } from '@family-time/schemas';

type Rows = [string, string][];

const block = (s: ChildStatus, type: string) => s.day.find((b) => b.type === type);

export const RIGHT_NOW: Partial<Record<TopicId, (s: ChildStatus) => Rows>> = {
  'pause-everything': (s) => {
    const rows: Rows = [['Pause everything', s.pause ? (s.pause.untilLabel ? `Paused until ${s.pause.untilLabel}` : 'Paused until you resume') : 'Not paused']];
    for (const b of s.day.filter((d) => d.type === 'pause')) rows.push([/pause$/i.test(b.label) ? b.label : `${b.label} pause`, `${b.startLabel} to ${b.endLabel}`]);
    const wind = block(s, 'wind-down');
    if (wind) rows.push(['Wind-down', `From ${wind.startLabel}`]);
    return rows;
  },
  'allow-block-normal': (s) =>
    s.services.map((x) => [x.name, `${x.state === 'allowed' ? 'Allowed' : x.state === 'paused' ? 'Paused' : 'Blocked'}${x.untilLabel ? ` until ${x.untilLabel}` : ''}`]),
  'todays-rhythm': (s) => s.day.filter((b) => b.type !== 'free').map((b) => [b.label, `${b.startLabel} to ${b.endLabel}`]),
  'device-status': (s) => s.devices.map((d) => [d.label, SYNC[d.sync]]),
  'device-gone-quiet': (s) => s.devices.map((d) => [d.label, d.quietSince ? 'Gone quiet' : d.lastSeenAt ? 'Checking in' : 'Not heard from yet']),
};

export const SYNC: Record<ChildStatus['devices'][number]['sync'], string> = {
  confirmed: 'Working on home Wi-Fi',
  pending: 'Updating. Takes up to a minute',
  'not-confirmed': "Hasn't picked up the last change. Still trying every minute",
  never: 'Not heard from yet. Connect it to your home Wi-Fi',
};
