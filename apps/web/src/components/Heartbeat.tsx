/**
 * The run page's answer to "is anything still happening?" (D-171).
 *
 * Frank's report was that a running scan looks stuck and says nothing about how much is left. The
 * second half needs a progress model the worker does not yet emit. The first half was already
 * answerable from data the browser has held all along: `claimed_at`, refreshed every minute by a
 * worker that is working and by nothing else.
 *
 * ## The dot animates when a beat arrives, and at no other time
 *
 * It used to be `animation: pulse 1s ease-in-out infinite` on `.layer.run`, which runs whether or
 * not anything is happening — so a worker that died at minute three pulsed contentedly until the
 * thirty-minute staleness rule noticed. The stylesheet already made this argument for the stalled
 * case: *"an animation that keeps running over dead work is the display lying quietly."* That was
 * right, and it was applied at one threshold when it is true at every moment.
 *
 * So the animation is one-shot and keyed on `claimedAt`. A new value is a beat that landed and
 * remounts the element, which starts the animation; an unchanged value leaves it finished and
 * still. What the reader sees moving is a beat being observed, not a stylesheet running.
 */

import { useEffect, useState } from 'react';
import { describeHeartbeat } from '../lib/heartbeat.js';

/**
 * A clock that re-renders once a second.
 *
 * The queue poll is on a three-second timer, so without this the age would advance in three-second
 * jumps and read as a stuttering counter. Elapsed time is a real quantity that genuinely changes
 * every second — this displays it at the rate it changes, which is the opposite of an animation
 * asserting activity nobody observed.
 */
function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);

  return now;
}

/**
 * The status dot.
 *
 * `key` is the whole mechanism: React remounts on a changed key, and a remounted element replays a
 * one-shot animation. No beat, no remount, no movement.
 *
 * `unclaimed` and `skewed` match no rule in the stylesheet, so both fall through to the base dot:
 * a grey ring that does not move. That is the right rendering for both — one has no worker to
 * report on, the other has no believable age — and neither may borrow the amber that `quiet` uses,
 * because amber asserts a silence that in neither case has been observed.
 */
export function LiveDot({
  claimedAt,
  stalled,
}: {
  readonly claimedAt: string | null;
  readonly stalled: boolean;
}): JSX.Element {
  const beat = describeHeartbeat(claimedAt, useNow(!stalled));
  return <span className="dot" key={claimedAt ?? 'unclaimed'} data-beat={stalled ? 'stalled' : beat.kind} />;
}

/**
 * When the worker last said it was there.
 *
 * Renders nothing for an unclaimed request — a request nobody has picked up has no claim to
 * refresh, and "no heartbeat" over it would report a worker's silence where there is no worker.
 *
 * Renders nothing when the run is already stalled either. `isStalled` says *"No worker has touched
 * this scan since <time>"*, which is this fact with more in it; printing both would be the same
 * observation twice (D-167).
 *
 * And nothing when the clocks disagree by more than a trivial skew. There is no age to report, and
 * an indicator showing an impossible value is worse than an absent one.
 */
export function HeartbeatLine({
  claimedAt,
  stalled,
}: {
  readonly claimedAt: string | null;
  readonly stalled: boolean;
}): JSX.Element | null {
  const beat = describeHeartbeat(claimedAt, useNow(!stalled));
  if (stalled || beat.kind === 'unclaimed' || beat.kind === 'skewed') return null;

  return <p className={`beat beat-${beat.kind}`}>{beat.text}</p>;
}
