// Maintenance mode (ADR 0017): while the owner has it on, every screen says so, so nobody wonders
// why a change won't save. Checked on load and on every live update.
import type { MaintenanceState } from '@family-time/schemas';
import { useFetched } from '../economy/data';

export function MaintenanceBanner() {
  const { data } = useFetched<MaintenanceState>('/api/maintenance');
  if (!data?.on) return null;
  return (
    <p className="maintenance" role="status">
      {data.message ? `${data.message.replace(/[.!?]?$/, '.')} ` : 'Family time is being worked on. '}Allow, Block and Pause still work. Other changes wait until it's done.
    </p>
  );
}
