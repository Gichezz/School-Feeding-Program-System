/**
 * Splits a work list into what is waiting and what is finished, keeping each part in
 * the order it was given. Waiting work is shown first; finished rows fold into one line.
 */
export function splitQueue(items) {
  return {
    open: items.filter((item) => !item.done),
    done: items.filter((item) => item.done),
  };
}
