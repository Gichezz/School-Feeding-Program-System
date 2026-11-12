import { Check, Circle, CircleDot } from 'lucide-react';

/**
 * Where someone is in a short sequence, e.g. setting up a school device.
 * Done steps have a check, the current one a dot and the words "You are here" for
 * screen readers; colour is never the only sign.
 *
 * steps: [{ key, label }]
 * current: key of the current step; steps before it are done
 * complete: true when every step is done
 */
function StepTrack({ steps, current, complete = false, label = 'Progress' }) {
  const currentIndex = complete ? steps.length : steps.findIndex((step) => step.key === current);
  return (
    <ol className="ui-steps" aria-label={label}>
      {steps.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
        const Icon = { done: Check, current: CircleDot, todo: Circle }[state];
        return (
          <li key={step.key} className={`ui-steps__step ui-steps__step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="ui-steps__marker" aria-hidden="true"><Icon /></span>
            <span className="ui-steps__label">
              {step.label}
              <span className="visually-hidden">
                {state === 'done' ? ' (done)' : state === 'current' ? ' (you are here)' : ' (not yet)'}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default StepTrack;
