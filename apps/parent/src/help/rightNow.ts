// "Right now" in the help panel: live values for the topics that have them. Everything comes from
// the status the server sent, so the panel and the Control screen always agree.
import type { TopicId } from '@family-time/help-content/content';
import type { ChildStatus, WeekSummary } from '@family-time/schemas';
import { minutes, pence } from '../economy/data';

type Rows = [string, string][];

const block = (s: ChildStatus, type: string) => s.day.find((b) => b.type === type);

export const RIGHT_NOW: Partial<Record<TopicId, (s: ChildStatus, w?: WeekSummary) => Rows>> = {
  'weekly-allowance': (_s, w) => (w ? [['Weekly allowance', minutes(w.allowanceMinutes)], ['Left to plan', minutes(w.leftMinutes)], ['Resets', w.resets]] : []),
  'unused-time-bonus': (_s, w) =>
    w
      ? [
          ['Rate', `${pence(w.rates.pencePerBlock)} per 30 minutes`],
          ['Weekly cap', pence(w.rates.weeklyCapPence)],
          ...(w.lastWeek ? ([['Last week', `${minutes(w.lastWeek.minutesLeft)} saved, ${pence(w.lastWeek.bonusPence)}`]] as Rows) : []),
        ]
      : [],
  'gradual-reduction': (_s, w) =>
    w?.nextStep
      ? [
          ['Next step', `${minutes(w.nextStep.minutes)} from ${w.nextStep.onLabel}`],
          ['Step size', `${minutes(w.nextStep.stepMinutes)} ${w.nextStep.everyWeeks === 1 ? 'every week' : `every ${w.nextStep.everyWeeks} weeks`}`],
          ['Never below', minutes(w.nextStep.floorMinutes)],
          ['Agreed at the review', w.nextStep.agreed ? 'Yes' : 'Not yet'],
        ]
      : [],
  'pocket-money': (_s, w) => (w ? [['Owed now', pence(w.moneyPence)]] : []),
  'flex-points': (_s, w) => (w ? [['Points now', String(w.flexPoints)], ['Each point', `${pence(w.rates.flexPence)} or ${minutes(w.rates.flexMinutes)}`]] : []),
  'savings-goal': (_s, w) => (w?.goal ? [['Saving for', w.goal.title], ['So far', `${pence(w.goal.savedPence)} of ${pence(w.goal.targetPence)}`]] : []),
  'earning-screen-time': (_s, w) => (w ? [['Cap this week', minutes(w.earnedCapMinutes)], ['Earned so far', minutes(w.earnedMinutes)]] : []),
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
