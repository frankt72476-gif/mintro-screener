/**
 * The operator notification for a response round (D-143).
 *
 * One message per submit event, and the same message with a different lead line when the last
 * outstanding invited address resolves. It goes to an operator, not to a merchant, which is both
 * the reason it can be short and the reason it is audited.
 *
 * ## Internal mail is where the vocabulary drifts back in
 *
 * Every reader-facing surface in this project is disciplined about not characterising a merchant.
 * This one is not reader-facing — and that is exactly the argument for auditing it. An operator who
 * reads *"the merchant failed to respond"* in their own inbox every week will eventually write it
 * into a covering note, where D-029 catches it after it has been typed rather than before it was
 * ever modelled.
 *
 * So it falls under the copy audit like everything else, against `PARTICIPATION_TERMS`:
 * `DIRECTIVE_TERMS` plus the characterisations that only make sense about a *party* —
 * "issues", "concerns", "failures", "unresponsive". `apps/worker/test/copy.test.ts` asserts it.
 *
 * ## It reports events, never conclusions
 *
 * "All invited responses are in" is a statement about a set of events Mintro recorded. It is not a
 * statement that the merchant has finished, that they cooperated, or that anything may now proceed
 * — the operator decides all three, and nothing here is a state transition (D-143). The message
 * ends at a link.
 */

/** Which of the two messages this is, and what happened to produce it. */
export interface ResponseNoticeInput {
  readonly merchantDomain: string;
  /** Where the operator opens the run. Built by `runLinkFor`, never spelled out here. */
  readonly runLink: string;
  /**
   * Whether this is the transition to all-in.
   *
   * Decided by the worker from `responseRoundFor`, not by this module. Composing and deciding are
   * separate so the decision has one implementation and the wording has one owner.
   */
  /**
   * Whether this is the transition to all-in.
   *
   * Never true for a re-submit: all-in is about the invited set resolving, and a re-submit is by
   * someone already resolved, so it cannot move the set (D-151).
   */
  readonly allIn: boolean;
  readonly submittedCount: number;
  readonly invitedCount: number;
  readonly event: ResponseNoticeEvent;
}

export type ResponseNoticeEvent =
  | { readonly kind: 'submitted'; readonly address: string; readonly at: Date }
  | {
      /**
       * They added to a response they had already submitted, and submitted it again (D-151).
       *
       * A real event with its own message, because the alternative was the addition surfacing only
       * as a flag in the operator's panel — which nobody is necessarily watching — while the page
       * confirmed to the merchant that something had happened.
       */
      readonly kind: 'resubmitted';
      readonly address: string;
      readonly at: Date;
      /** When the newest thing they added was written. A stored time, never a clock read. */
      readonly addedAt: Date | null;
    }
  | {
      readonly kind: 'not_responding';
      readonly address: string;
      /** The analyst who made the judgement. Named because it is theirs (D-145). */
      readonly by: string | null;
      readonly at: Date;
    };

export interface ResponseNotice {
  readonly subject: string;
  readonly body: string;
}

/** UTC, to the minute. Every timestamp in this system is UTC and this one says so. */
function stamp(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function composeResponseNotice(input: ResponseNoticeInput): ResponseNotice {
  const { merchantDomain, runLink, allIn, submittedCount, invitedCount, event } = input;

  const subject =
    event.kind === 'resubmitted'
      ? `Response added after submitting — ${merchantDomain}`
      : allIn
        ? `All invited responses are in — ${merchantDomain}`
        : `Response submitted — ${merchantDomain}`;

  /*
    What happened, named as an event with an actor and a time.

    A submit event is the responder's own report of their state, and the wording keeps it theirs:
    "identified themselves as", the same phrase every other surface uses, because the address is
    self-declared and nothing verifies it (D-144). A not-responding line names the analyst instead,
    because that judgement is Mintro's and attributing it to the merchant is the one thing D-145
    forbids.
  */
  const happened =
    event.kind === 'submitted'
      ? `Someone identified as ${event.address} submitted their response on ${stamp(event.at)}.`
      : event.kind === 'resubmitted'
        ? `Someone identified as ${event.address} submitted again on ${stamp(event.at)}` +
          `${event.addedAt === null ? '' : `, over text added on ${stamp(event.addedAt)}`}.` +
          ' Their earlier response stands; this is an addition to it.'
        : `${event.address} was marked as not responding${event.by === null ? '' : ` by ${event.by}`}` +
          ` on ${stamp(event.at)}. That is an operator judgement, recorded as one.`;

  const lead =
    event.kind === 'resubmitted'
      ? // States the event and stops. Not "please re-read" — what the operator does about it is
        // theirs, and the run view carries the words themselves.
        'A responder added to their response after submitting.'
      : allIn
        ? // The lead line, and nothing after it about what that means. All-in is a prompt, not an
          // instruction and not a state the tool has entered (D-143).
          'All invited responses are in.'
        : null;

  const body = [
    ...(lead === null ? [] : [lead, '']),
    `Screening report for ${merchantDomain}.`,
    '',
    happened,
    '',
    `${submittedCount} of ${invitedCount} invited have submitted.`,
    '',
    'The run:',
    '',
    `  ${runLink}`,
    ...(allIn
      ? [
          '',
          // Said plainly, because an operator who sees this once a week will otherwise read all-in
          // as the system having done something. It has not: the round ends when they send (D-148).
          'Nothing has been closed or sent. The response round ends when the combined document goes',
          'to IQwallet.',
        ]
      : []),
  ].join('\n');

  return { subject, body };
}
