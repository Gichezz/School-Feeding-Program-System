import { CheckCircle2, Hourglass, PauseCircle, RotateCw, Smartphone } from 'lucide-react';

/**
 * The one set of words for where a record is, used on every list in Lishe.
 * Each state is always shown with its icon and its words, never colour alone.
 *
 * local:   saved on this device, not sent yet
 * sent:    on the server
 * waiting: changed on another device too; the programme officer chooses which to keep
 * hold:    the server did not count it until a programme officer clears it
 * retry:   sending failed; Lishe tries again by itself
 */
export const RECORD_STATES = {
  local: { label: 'Saved on this device', icon: Smartphone },
  sent: { label: 'Sent', icon: CheckCircle2 },
  waiting: { label: 'Waiting for officer', icon: Hourglass },
  hold: { label: 'On hold', icon: PauseCircle },
  retry: { label: 'Not sent – will retry', icon: RotateCw },
};

/**
 * The record state for a stored record or queued change.
 *
 * @param {string} syncStatus - 'pending' | 'synced' | 'failed' | 'conflict' | 'held'
 * @param {{ errorMessage?: string }} [extra] - a pending change with an error has had a failed attempt
 * @returns {'local' | 'sent' | 'waiting' | 'hold' | 'retry'}
 */
export function recordStateFor(syncStatus, { errorMessage } = {}) {
  switch (syncStatus) {
    case 'synced':
      return 'sent';
    case 'conflict':
      return 'waiting';
    case 'held':
      return 'hold';
    case 'failed':
      return 'retry';
    default:
      return errorMessage ? 'retry' : 'local';
  }
}
