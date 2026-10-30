import type { TopicId } from '@family-time/help-content/content';
import { Icon } from '../icons';
import { useHelp } from './HelpContext';

/**
 * The (?) button: a 44-point target with a spoken label, "Help: Pause everything". `topic` is a
 * TopicId, built from the help files, so naming a topic that does not exist fails the typecheck.
 */
export function HelpButton({ topic, label }: { topic: TopicId; label: string }) {
  const help = useHelp();
  if (!help.iconsOn) return null;
  return (
    <button type="button" className="help-btn" aria-label={`Help: ${label}`} data-help={topic} onClick={(e) => help.open(topic, e.currentTarget)}>
      <Icon name="help" />
    </button>
  );
}
