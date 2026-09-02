/**
 * Three homes from one page (D-229, D-230).
 *
 * The differences are removals, and the removals are the feature. So they are decided once, here,
 * rather than as conditionals scattered through the rail, the run list and the account menu — a
 * screen whose absences are spread across four files is a screen nobody can check.
 *
 *   owner        everything
 *   host member  the owner's view of the work, none of the owner's controls
 *   partner      their own organisation's work, and no sign the others exist
 *
 * ## Absent, not disabled
 *
 * D-230 states it for capabilities and it holds for all of this: a member without something sees
 * no control for it — no greyed item, no lock, no request-access prompt. A visible-but-disabled
 * control teaches somebody that a feature exists and that they are excluded from it, which for the
 * org filter would also teach them that other organisations exist. The tests assert the strings are
 * **not in the markup**, which is the only way to tell absent from styled-away.
 */

export interface Viewer {
  readonly role: 'owner' | 'admin';
  readonly isHost: boolean;
  readonly canRunDocumentsCheck: boolean;
  readonly canSubmitToIqwallet: boolean;
}

export interface HomeShape {
  /** Every organisation's work, or only your own. */
  readonly seesEveryOrg: boolean;
  /** The Run by column and the org filter row. Chips naming other organisations are the leak. */
  readonly showsRunBy: boolean;
  readonly showsOrgFilter: boolean;
  /** People and the access log in the account menu. Administration is owner-only (D-229). */
  readonly showsAdministration: boolean;
  /**
   * The Documents Check nav item.
   *
   * Presence only. This decides whether the tab is drawn, not whether the action behind it is
   * permitted, and the two stay deliberately separate: the gate of record is the API — 0069's
   * policies and function guards — and a nav item has never been a gate (D-230).
   */
  readonly showsDocumentsTab: boolean;
  /**
   * The Send to IQwallet button on a report.
   *
   * Presence only, and the same rule as the Documents Check tab: the gate of record is
   * `send_requests_insert` (0069), which resolves the capability from `auth.uid()`. Drawing the
   * button for somebody without the flag would not let them send; it would let them press it and be
   * refused, which is worse than not offering it.
   */
  readonly showsSubmitAction: boolean;
  /**
   * *Mark ready for Mintro review*, in place of Send.
   *
   * The exact complement of `showsSubmitAction`, and written as the complement rather than as its
   * own condition: a viewer who saw both would be offered two ways to finish, and one who saw
   * neither would have finished a report with nowhere to put it. That second case is the whole
   * reason the review path exists, and a separate condition is how it would come back.
   *
   * Marking is not gated in the database (0070) — anyone who can read the run may hand it over.
   * This decides what is drawn, and for somebody who can submit directly the mark is a longer way
   * round to the same place.
   */
  readonly showsMarkReadyAction: boolean;
  /**
   * The one line a partner is told about who else can see their work.
   *
   * Absent for the owner and for host members: they are the ones who can see everything, and a
   * line telling them so is noise. Present exactly once for a partner (D-229).
   */
  readonly showsDisclosure: boolean;
}

export function homeShape(viewer: Viewer): HomeShape {
  const owner = viewer.role === 'owner';
  const seesEveryOrg = owner || viewer.isHost;

  return {
    seesEveryOrg,
    showsRunBy: seesEveryOrg,
    showsOrgFilter: seesEveryOrg,
    // Not `seesEveryOrg`: a host member has the owner's view of the work and none of the owner's
    // controls. This is the single line that separates Michael's home from Frank's.
    showsAdministration: owner,
    // The owner holds every capability by construction (0060's check constraint), so the flag is
    // read rather than special-cased — an owner whose flag were false is unrepresentable.
    showsDocumentsTab: viewer.canRunDocumentsCheck,
    showsSubmitAction: viewer.canSubmitToIqwallet,
    showsMarkReadyAction: !viewer.canSubmitToIqwallet,
    showsDisclosure: !seesEveryOrg,
  };
}

/**
 * What a run marked ready for Mintro review is called, to the two people looking at it (D-229).
 *
 * One fact, two readings, and both are the plain truth from where they stand: the partner has
 * handed the work over, and Mintro has it to do. Neither phrasing is available to the other — "with
 * Mintro" said to a host member is Mintro telling itself where its own work is, and "ready for
 * review" said to a partner reads as an instruction to review it.
 *
 * Defined here, beside everything else that differs by viewer, so the two cannot drift into
 * describing different states. Picked by `seesEveryOrg`, which is the same flag that decides the
 * rest of the page.
 */
export const REVIEW_STATE_LABEL = {
  /** The owner and host members: the work is theirs to finish. */
  host: 'Ready for review',
  /** The partner who handed it over: they can see where it went. */
  partner: 'With Mintro',
} as const;

export function reviewStateLabel(shape: Pick<HomeShape, 'seesEveryOrg'>): string {
  return shape.seesEveryOrg ? REVIEW_STATE_LABEL.host : REVIEW_STATE_LABEL.partner;
}

/**
 * What the partner is told when they mark a run, beneath the button.
 *
 * Names Mintro and no person (D-233), and says what happens next rather than thanking them for
 * doing it. It does not promise a time — nothing in this system knows one, and a sentence that
 * implied it would be the first thing to become untrue.
 */
export const MARK_READY_NOTE =
  'Mintro will review this screening and send it to IQwallet.';

/**
 * What a partner is told, once, under their runs (D-229, D-233).
 *
 * **Mintro is the actor, never a person.** Naming a host member here would tell a partner which
 * individual reads their work, which is the operator identity the outbound pass removed from every
 * other surface — and it would be worse here, because it is a standing fact rather than one
 * attribution.
 *
 * It says nothing about other organisations. A partner knows their own agency and knows Mintro is
 * above them; that other partners exist is the fact this whole build keeps from them, and a
 * disclosure line is exactly where it would slip out ("every organisation on the account" invites
 * the question). Written to be true and to end the thought.
 *
 * Disclosure, not warning. The tool's posture is that observation is disclosed rather than implied,
 * and the visibility rules inside it should not work differently from the ones it applies to
 * merchants.
 */
export const PARTNER_DISCLOSURE =
  'You see your organisation’s screenings. Mintro can see them too.';

/** The posture sentence, verbatim from the invitation email. */
export const POSTURE =
  'Mintro reports what it observed; it does not underwrite the account or decide the outcome.';
