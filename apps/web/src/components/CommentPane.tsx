/**
 * The merchant-facing report (D-063).
 *
 * Reached by `?comment=<token>` with no account and no session. The token is the entire
 * credential, and the two database functions it can call are the whole of what it does.
 *
 * ## It shows the evidence
 *
 * This renders `ReportView` — the same component the analyst sees and the same one the PDF prints.
 * Screenshots, matched text, the requirement column, the coverage breakdown, all of it.
 *
 * That is the reason a web page was chosen over a marked-up PDF: **a merchant comments while
 * looking at the capture**, not at a flattened document that has lost it. A page reduced to a list
 * of findings with boxes beneath them would be the PDF with extra steps, and would invite a
 * response to a sentence rather than to the screenshot the sentence describes.
 *
 * ## What it does not do
 *
 * No account, no dashboard, no other run, no history. One link, one report, a box under each
 * invited finding, save, submit. **Nothing here can change a finding**, and the only writes it can
 * reach are `identify_for_comment`, `submit_merchant_comment`, `submit_merchant_attestation` and
 * `submit_response_round` — four security-definer functions that take the token as their whole
 * credential and none of which can touch `runs` or `findings`.
 *
 * ## Saving, and saying you are finished (D-143, D-144, D-147)
 *
 * Boxes autosave on blur; one Save button writes them all; a Submit button records that the person
 * considers their response complete. The three are different acts and the page keeps them apart:
 * Save is about the words, Submit is about the person, and **neither closes anything**. Post-submit
 * edits save exactly as before — a responder reporting their own state is not a state this page
 * enters.
 *
 * Submit renders only for an address Mintro sent the report to. That is a display convention, not
 * authentication — the identity is typed into a box and nothing verifies it — so no copy here calls
 * the button restricted, secured or authorised, and everyone else is told who *will* submit rather
 * than left with a control that silently is not there.
 */

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  commentaryFor,
  commentTokenFrom,
  type CommentVisit,
  type FindingCommentary,
  type MerchantComment,
  type ReportFinding,
  type ScreeningReport,
} from '@mintro/engine';
import { createEvidenceAccess } from '../lib/evidence.js';
import { clearVisit, readVisit, writeVisit } from '../lib/visitStore.js';
import {
  NOTHING_OBSERVED_ID,
  invitedFindings,
  nothingObservedCount,
} from '../lib/grouping.js';
/**
 * The key the eye-test reply travels under inside this component (D-209).
 *
 * Not a rule id — it cannot be, since `merchant_comments.rule_id` takes only `^[A-Z]+-[0-9]{3}$`
 * (D-203) — and deliberately not shaped like one, so a value that leaked into a rule field would be
 * refused by the database rather than filed against an imaginary rule.
 */
const EYE_TEST_SUBJECT = 'subject:eye-test';

import { AttestationForm } from './Attestations.js';
import { ReportView } from './ReportView.js';
import { formatClock, formatStamp } from '../lib/format.js';

/** `?comment=<token>` — the merchant's whole credential. */
export function commentToken(): string | null {
  // The shape lives in `@mintro/engine` and is stated in exactly one place. It was stated in two
  // once — the worker built a path and this read a query parameter — and an invitation would have
  // delivered a merchant to the analyst sign-in screen (D-034).
  return commentTokenFrom(window.location.href);
}

/**
 * One stored answer as the form shows it back (D-205).
 *
 * `writtenBy` and `writtenAt` are always present — an answer in this map came from somewhere, and
 * the form says where. `carriedForwardFrom` is set only where it came from an earlier screening.
 */
interface StoredAnswer {
  readonly outcome: 'answered' | 'declined';
  readonly body?: string;
  readonly writtenBy: string;
  readonly writtenAt: string;
  readonly carriedForwardFrom?: string;
}

interface OpenedReport {
  readonly runId: string;
  readonly merchantDomain: string;
  readonly expiresAt: string;
  readonly report: ScreeningReport;
  readonly comments: readonly MerchantComment[];
  readonly visits: readonly CommentVisit[];
  /**
   * The addresses Mintro sent this report to, earliest first (D-144).
   *
   * Submit is offered to these and to nobody else. **That is a display convention, not a
   * check on who anyone is** — the identity is typed into a box and nothing verifies it, so a
   * submit event carries no more assurance than a comment does. Nothing on this page describes the
   * button as restricted, secured, or authorised, because it is none of those things.
   *
   * It also tells whoever holds a forwarded link which address will submit on their behalf, which
   * is the point: an absent button with no explanation reads as something being broken.
   */
  readonly invited: readonly string[];
  readonly submissions: readonly {
    readonly identifiedAs: string;
    readonly submittedAt: string;
    /** The newest text they had written when they pressed it (D-151). Null means none. */
    readonly coversContentAt: string | null;
  }[];
  /**
   * Attestation answers with their times, bodies excluded (D-151).
   *
   * The page counts these alongside comments when deciding whether pressing Submit again would
   * record anything, because an answer to one of the nineteen questions is text the merchant added
   * exactly as a comment is. The database asks the same question over the same two channels.
   */
  /**
   * The answers already stored for this run, in full (D-205).
   *
   * Bodies included since 0052. They were withheld on the reasoning that the page had never
   * replayed another visitor's answers back at them — which withheld nothing, because the `report`
   * in this same payload renders every one of them with its attribution, on this page, at this link.
   */
  readonly attestations: readonly {
    readonly questionId?: string;
    readonly outcome?: 'answered' | 'declined';
    readonly body?: string | null;
    readonly identifiedAs: string;
    readonly submittedAt: string;
    readonly inheritedFromRun?: string | null;
    readonly originallyAnsweredAt?: string | null;
  }[];
}

type Opened =
  | { readonly status: 'loading' }
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'open'; readonly value: OpenedReport };

export function CommentPane({
  client,
  token,
}: {
  readonly client: SupabaseClient;
  readonly token: string;
}): JSX.Element {
  const [opened, setOpened] = useState<Opened>({ status: 'loading' });
  const access = useMemo(() => createEvidenceAccess(client), [client]);

  useEffect(() => {
    let live = true;

    void client
      .rpc('open_report_for_comment', { p_token: token })
      .then(({ data, error }) => {
        if (!live) return;
        if (error !== null || data === null) {
          // A failed read is not an invalid link (D-036). Saying "this link is not valid" here
          // would tell a merchant their invitation is dead when the database was unreachable.
          setOpened({
            status: 'invalid',
            reason: 'The report could not be loaded just now. Please try again shortly.',
          });
          return;
        }

        const payload = data as { ok: boolean; reason?: string } & Partial<OpenedReport>;
        if (!payload.ok) {
          setOpened({ status: 'invalid', reason: payload.reason ?? 'this link is not valid' });
          return;
        }

        setOpened({ status: 'open', value: payload as unknown as OpenedReport });
      });

    return () => {
      live = false;
    };
  }, [client, token]);

  if (opened.status === 'loading') {
    return (
      <div className="shell">
        <main className="main">
          <div className="empty">Loading the report…</div>
        </main>
      </div>
    );
  }

  if (opened.status === 'invalid') {
    return (
      <div className="shell">
        <main className="main">
          <div className="eyebrow">Screening report</div>
          <h1>This link cannot be opened</h1>
          <p className="sub">{opened.reason}</p>
          <p className="sub">
            Replying to the message that carried this link reaches a person. Anything already
            written on this report is kept.
          </p>
        </main>
      </div>
    );
  }

  return <OpenReport client={client} token={token} opened={opened.value} access={access} />;
}

function OpenReport({
  client,
  token,
  opened,
  access,
}: {
  readonly client: SupabaseClient;
  readonly token: string;
  readonly opened: OpenedReport;
  readonly access: ReturnType<typeof createEvidenceAccess>;
}): JSX.Element {
  const [comments, setComments] = useState<readonly MerchantComment[]>(opened.comments);

  /*
    Who is here (D-063), remembered for the length of the tab (D-071).

    The link is forwardable and goes to the agent as often as to the merchant, so whoever lands
    says who they are before they can write.

    Held in `sessionStorage`, which survives a refresh and dies with the tab. Not `localStorage`:
    the next person to open this link on a shared machine is a different person, and letting their
    words be attributed to someone else's address would break the one mechanism that makes this
    document useful to an underwriter.
  */
  const [identity, setIdentity] = useState<{ readonly visitId: string; readonly email: string } | null>(
    null,
  );


  /*
    Restore, and note what it deliberately does not do (D-071).

    **It writes no `comment_visits` row.** A visit is a fact about someone arriving and saying who
    they are; a refresh is neither, and a row per reload would tell an underwriter that someone
    identified themselves six times when they identified themselves once and pressed F5.

    The stored visit id is reused, so anything written after a refresh binds to the original visit —
    which is true: same person, same sitting.
  */
  useEffect(() => {
    if (identity !== null) return;

    const stored = readVisit(token, opened.runId);
    if (stored !== null) setIdentity({ visitId: stored.visitId, email: stored.email });
    // `identity` is read but intentionally not a dependency: this restores once per opened report,
    // and re-running it after someone changes their address would undo the change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened.runId]);

  /*
    The findings that carry a box, from the same grouping that renders them.

    This walked `report.categories` directly until Save became a page-level button. That produced a
    list with no ordinals, and an ordinal is what tells one sampled page's box from another's — so a
    Save that walked it would have written every repeat of a rule into the first one's slot.

    `invitedFindings` walks `groupReport`, which is what `ReportView` renders from and what the
    participation record counts against (D-034). One traversal, three consumers.
  */
  const invited = useMemo(() => invitedFindings(opened.report), [opened.report]);

  /*
    The merchant has opened the report, by definition — they are looking at it. So every invited
    finding is `no_comment` until they write, never `unopened` (D-063).
  */
  const commentaryOf = (finding: ReportFinding, ordinal?: number): FindingCommentary =>
    commentaryFor(
      finding,
      ordinal,
      {
        issued: true,
        firstOpenedAt: new Date().toISOString(),
        visits:
          identity === null
            ? opened.visits
            : [...opened.visits, { identifiedAs: identity.email, identifiedAt: new Date().toISOString() }],
      },
      comments,
    );

  const identify = async (email: string): Promise<string | null> => {
    const { data, error } = await client.rpc('identify_for_comment', {
      p_token: token,
      p_email: email,
    });

    const payload = data as { ok?: boolean; reason?: string; visitId?: string } | null;
    if (error !== null || payload?.ok !== true || payload.visitId === undefined) {
      return payload?.reason ?? 'That could not be saved just now. Please try again.';
    }

    setIdentity({ visitId: payload.visitId, email });

    // Convenience for the writer, never evidence: `submit_merchant_comment` reads the address from
    // the visit row server-side, so what a comment is attributed to is what the database holds.
    writeVisit(token, { visitId: payload.visitId, email, runId: opened.runId });
    return null;
  };

  /**
   * Someone else is writing now, or the same person under a different address.
   *
   * Forgets the stored identity and asks again. **It deletes nothing** — the visit that was
   * recorded happened, and anything written under it stays attributed to it. The next
   * identification writes a new visit, because a new declaration is a new fact (D-071).
   */
  /** What this visitor has sent this session, for showing back to them. Never a source of truth. */
  const [answers, setAnswers] = useState<
    ReadonlyMap<string, StoredAnswer>
  >(new Map());

  /*
    What is already stored for this run, replayed into the form (D-205).

    Including answers carried forward from an earlier screening of this domain (D-204) — which is
    the whole point: a merchant who answered nineteen questions in August should not answer them
    again in October because we re-crawled.

    Each one keeps **who wrote it and when**. Under a forwardable link (D-063) that attribution is
    the safeguard rather than the risk: a merchant seeing that their agent answered this on 12
    August is better placed than one typing blind into a box and contradicting them.

    Seeded once per open, and never again — after that this map is what *this* visitor has done,
    which is what it has always been. A later re-seed would overwrite their unsent edits.
  */
  useEffect(() => {
    setAnswers((existing) => {
      if (existing.size > 0) return existing;
      const seeded = new Map<string, StoredAnswer>();
      for (const stored of opened.attestations) {
        if (stored.questionId === undefined || stored.outcome === undefined) continue;
        seeded.set(stored.questionId, {
          outcome: stored.outcome,
          ...(typeof stored.body === 'string' ? { body: stored.body } : {}),
          writtenBy: stored.identifiedAs,
          writtenAt: stored.submittedAt,
          ...(typeof stored.originallyAnsweredAt === 'string'
            ? { carriedForwardFrom: stored.originallyAnsweredAt }
            : {}),
        });
      }
      return seeded;
    });
  }, [opened]);

  const forgetIdentity = (): void => {
    clearVisit(token);
    setIdentity(null);
  };

  /**
   * Answering one of the questions the crawl cannot reach (D-134).
   *
   * The same link, the same visit, the same identity as a comment — one channel (D-063), because a
   * second would be a second thing to keep working and a second place for the identity rules to
   * drift.
   */
  const answer = async (
    questionId: string,
    outcome: 'answered' | 'declined',
    body: string | null,
  ): Promise<string | null> => {
    if (identity === null) return 'Please give an email address above before answering.';

    const { data, error } = await client.rpc('submit_merchant_attestation', {
      p_token: token,
      p_question_id: questionId,
      p_outcome: outcome,
      p_body: body,
      p_visit_id: identity.visitId,
    });

    const payload = data as { ok?: boolean; reason?: string; submittedAt?: string } | null;
    if (error !== null || payload?.ok !== true) {
      // Same recovery as a comment: a stored visit from a different link is refused server-side,
      // and asking again is the honest fix. Nothing typed is cleared on failure.
      if (payload?.reason?.includes('email address is needed') === true) forgetIdentity();
      return payload?.reason ?? 'That could not be saved just now. Please try again.';
    }

    /*
      Answering moves the watermark (D-151).

      The stored time, read back, rather than the browser's clock: the database compares against the
      row's own `submitted_at`, and a boundary the two disagree about is a Submit button that offers
      a press recording nothing.
    */
    if (payload.submittedAt !== undefined) {
      const at = payload.submittedAt;
      setAttestedAt((existing) => [...existing, { identifiedAs: identity.email, submittedAt: at }]);
    }

    setAnswers((existing) => {
      const next = new Map(existing);
      /*
        Editing makes it theirs (D-204, §4).

        No `carriedForwardFrom`: the row the write path just appended carries no provenance columns,
        so the stored answer is theirs on this run, and the form has to agree with the database
        rather than keep showing a mark the row no longer has.
      */
      next.set(questionId, {
        outcome,
        ...(outcome === 'declined' ? {} : { body: body ?? '' }),
        writtenBy: identity.email,
        writtenAt: payload.submittedAt ?? new Date().toISOString(),
      });
      return next;
    });
    return null;
  };

  /*
    What is in each box right now, held here rather than in each box.

    Autosave and the page's one Save button both need to reach every field, and a page-level button
    that could only save the box somebody last touched would be a Save button that does not save.
    Keyed the way a comment is keyed, so a draft and the comment it becomes cannot disagree about
    which finding they belong to.
  */
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());

  /** When each field was last confirmed stored, from the database's own clock, never the browser's. */
  const [savedAt, setSavedAt] = useState<ReadonlyMap<string, string>>(new Map());

  const [submissions, setSubmissions] = useState(opened.submissions);
  const [attestedAt, setAttestedAt] = useState<readonly { identifiedAs: string; submittedAt: string }[]>(
    opened.attestations,
  );
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);

  const keyOf = (ruleId: string, ordinal: number | undefined): string => `${ruleId}::${ordinal ?? 'x'}`;

  /**
   * The last thing this identity stored about a finding.
   *
   * The comparison autosave skips on, and the text a returning tab starts from. Matched on the
   * folded address because someone who refreshes and re-identifies is the same person continuing
   * the same response, which is the rule the database applies too.
   */
  const storedBody = (ruleId: string, ordinal: number | undefined): string => {
    if (identity === null) return '';
    if (ruleId === EYE_TEST_SUBJECT) {
      const mine = comments.filter(
        (comment) =>
          comment.subject === 'eye-test' &&
          comment.identifiedAs.trim().toLowerCase() === identity.email.trim().toLowerCase(),
      );
      return mine[mine.length - 1]?.body ?? '';
    }
    const mine = comments.filter(
      (comment) =>
        comment.ruleId === ruleId &&
        (comment.ordinal ?? undefined) === ordinal &&
        comment.identifiedAs.trim().toLowerCase() === identity.email.trim().toLowerCase(),
    );
    return mine[mine.length - 1]?.body ?? '';
  };

  const bodyOf = (ruleId: string, ordinal: number | undefined): string =>
    drafts.get(keyOf(ruleId, ordinal)) ?? storedBody(ruleId, ordinal);

  /**
   * Writes one field, and records what the database says about it.
   *
   * `wrote: false` is not a failure and not a no-op — the row was read and its stored time came
   * back. That is why an unchanged Save can confirm a timestamp earlier than the press: it is the
   * honest answer to *when was this saved* (D-147).
   */
  const saveField = async (
    ruleId: string,
    ordinal: number | undefined,
    body: string,
  ): Promise<string | null> => {
    if (identity === null) return 'Please give an email address above before writing a response.';

    /*
      The eye-test reply is stored against a subject, not a rule (D-203).

      One sentinel through the same field, so the draft map, the autosave and the Save button need
      no second path — and the database refuses a row that names both, so a mistake here is a
      refusal rather than a mis-filed comment.
    */
    const subject = ruleId === EYE_TEST_SUBJECT;

    const { data, error } = await client.rpc('submit_merchant_comment', {
      p_token: token,
      p_rule_id: subject ? null : ruleId,
      p_ordinal: subject ? null : ordinal ?? null,
      p_body: body,
      p_visit_id: identity.visitId,
      ...(subject ? { p_subject: 'eye-test' } : {}),
    });

    const payload = data as { ok?: boolean; reason?: string; savedAt?: string; wrote?: boolean } | null;
    if (error !== null || payload?.ok !== true) {
      /*
        The server validates the visit against *this link*, not merely this run (0016). A stored
        visit from a different link — a second invitation opened in the same tab — is refused here.

        Clearing it and asking again is the honest recovery. What they typed is untouched: the box
        keeps its text on failure, so nothing they wrote is lost to a re-identification.
      */
      if (payload?.reason?.includes('email address is needed') === true) forgetIdentity();
      return payload?.reason ?? 'That could not be saved just now. Please try again.';
    }

    const at = payload.savedAt ?? new Date().toISOString();
    setSavedAt((existing) => new Map(existing).set(keyOf(ruleId, ordinal), at));

    if (payload.wrote === true) {
      setComments((existing) => [
        ...existing,
        {
          ruleId,
          ...(ordinal === undefined ? {} : { ordinal }),
          identifiedAs: identity.email,
          body,
          submittedAt: at,
        },
      ]);
    }
    return null;
  };

  /**
   * Autosave, on blur.
   *
   * **A field whose text has not changed writes nothing at all** — not a request the server
   * declines, no request. Tabbing through a report is the ordinary way to read one, and every
   * untouched field it passes would otherwise be a round trip and a row (D-147).
   */
  const autosave = (ruleId: string, ordinal: number | undefined): void => {
    if (identity === null) return;
    const body = bodyOf(ruleId, ordinal);
    if (body.trim() === '' || body === storedBody(ruleId, ordinal)) return;

    void saveField(ruleId, ordinal, body).then((failure) => {
      if (failure !== null) setSaveProblem(failure);
    });
  };

  /**
   * The Save button: every field with text in it, written now.
   *
   * A real round trip per field, even where nothing changed, because the confirmation has to mean
   * *the database holds this* rather than *the browser thinks so*. Where nothing changed the write
   * is refused server-side and the stored time comes back instead, which is what the button then
   * shows.
   */
  const saveEvery = async (): Promise<{ readonly written: number; readonly failure: string | null }> => {
    const fields = invited
      .map((finding) => ({
        ruleId: finding.ruleId,
        ordinal: finding.ordinal,
        body: bodyOf(finding.ruleId, finding.ordinal),
      }))
      .filter((field) => field.body.trim() !== '');

    for (const field of fields) {
      const failure = await saveField(field.ruleId, field.ordinal, field.body);
      // Stops at the first failure rather than pressing on. Continuing would leave some fields
      // stored and some not behind a single message, and the reader could not tell which.
      if (failure !== null) return { written: fields.length, failure };
    }

    return { written: fields.length, failure: null };
  };

  const saveAll = async (): Promise<void> => {
    setSaving(true);
    setSaveProblem(null);

    const { written, failure } = await saveEvery();
    setSaving(false);

    if (failure !== null) {
      setSaveNote(null);
      setSaveProblem(failure);
      return;
    }

    setSaveNote(
      written === 0
        ? // Honest rather than reassuring: nothing was stored, so "Saved" would be a claim about a
          // write that did not happen.
          'Nothing written yet.'
        : `Saved · ${formatClock(new Date().toISOString())}`,
    );
  };

  /*
    Whether this identity is one of the addresses Mintro wrote to (D-144).

    A display convention and nothing more. The address was typed into a box on this page and nothing
    verifies it — so this decides which control is shown, never who anybody is, and no copy on this
    page calls the button restricted or secured.
  */
  const maySubmit =
    identity !== null &&
    opened.invited.some(
      (address) => address.trim().toLowerCase() === identity.email.trim().toLowerCase(),
    );

  const fold = (address: string): string => address.trim().toLowerCase();

  /** This identity's submit events, oldest first. */
  const mySubmissions = useMemo(
    () =>
      identity === null
        ? []
        : submissions
            .filter((event) => fold(event.identifiedAs) === fold(identity.email))
            .slice()
            .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt)),
    [submissions, identity],
  );

  /** Their first press — what the confirmation reads back. */
  const mySubmission = mySubmissions[0];
  const myLatestSubmission = mySubmissions[mySubmissions.length - 1];

  /**
   * The newest thing this identity has written, across both channels (D-151).
   *
   * The same watermark `submit_response_round` computes, over the same two tables, so the button and
   * the database agree about whether a press would record anything. Two expressions of that would be
   * a button that offers a press the server declines — which is the defect this replaced, in a new
   * spelling.
   */
  const myContentAt = useMemo(() => {
    if (identity === null) return null;
    const mine = [...comments, ...attestedAt]
      .filter((entry) => fold(entry.identifiedAs) === fold(identity.email))
      .map((entry) => Date.parse(entry.submittedAt))
      .filter((at) => !Number.isNaN(at));
    return mine.length === 0 ? null : Math.max(...mine);
  }, [comments, attestedAt, identity]);

  /**
   * What the Submit control should say, or null for no control at all.
   *
   * Three states, and the middle one is the fix: after submitting, the button **goes away** until
   * there is something new to submit. It used to read "Submit again" permanently, so a merchant who
   * added a paragraph and pressed it was told something had happened when the database had recorded
   * nothing — and a merchant who pressed it having changed nothing was told the same.
   *
   * Never a press that confirms an event which did not fire.
   */
  const submitControl: string | null = (() => {
    if (!maySubmit) return null;
    if (myLatestSubmission === undefined) return 'Submit';

    const covered = myLatestSubmission.coversContentAt;
    const coveredAt = covered === null ? null : Date.parse(covered);
    const hasNewer =
      myContentAt !== null && (coveredAt === null || myContentAt > coveredAt);

    return hasNewer ? 'Submit your addition' : null;
  })();

  /**
   * Submitting.
   *
   * Saves everything first, so a field still open when they press it is part of what they submitted
   * rather than a draft they assume went. Then records the event — idempotently, per identity, in
   * the database: pressing twice finds the first event and returns it, so a second press produces no
   * second event whatever the network did with the first.
   *
   * **It locks nothing.** The boxes stay open, autosave keeps working, and anything written
   * afterwards is saved exactly as before.
   */
  const submitRound = async (): Promise<void> => {
    if (identity === null) return;

    setSaving(true);
    setSaveProblem(null);

    const { failure } = await saveEvery();
    if (failure !== null) {
      // Nothing is submitted over an unsaved field. The event would say their response is complete
      // while the words it refers to are only in a browser.
      setSaving(false);
      setSaveNote(null);
      setSaveProblem(failure);
      return;
    }

    const { data, error } = await client.rpc('submit_response_round', {
      p_token: token,
      p_visit_id: identity.visitId,
    });

    const payload = data as
      | {
          ok?: boolean;
          reason?: string;
          recorded?: boolean;
          identifiedAs?: string;
          submittedAt?: string;
          coversContentAt?: string | null;
        }
      | null;

    setSaving(false);

    if (error !== null || payload?.ok !== true) {
      if (payload?.reason?.includes('email address is needed') === true) forgetIdentity();
      setSaveProblem(payload?.reason ?? 'That could not be recorded just now. Please try again.');
      return;
    }

    setSaveNote(null);

    /*
      The row the database actually holds, appended rather than replacing (D-151).

      Appended because a re-submit is a second event and both are real. `coversContentAt` comes back
      from the server rather than being recomputed here, so the page's view of what a press covered
      is the row's own value — recomputing it would be a second expression of the watermark, and the
      two would eventually disagree about whether to offer the button.

      `recorded: false` is the case where nothing was written: the button should not have been on
      screen, and appending an event here would make the page claim one anyway.
    */
    if (payload.recorded === true) {
      const event = {
        identifiedAs: payload.identifiedAs ?? identity.email,
        submittedAt: payload.submittedAt ?? new Date().toISOString(),
        coversContentAt: payload.coversContentAt ?? null,
      };
      setSubmissions((existing) => [...existing, event]);
    }
  };

  return (
    <div className="shell">
      <main className="main">
        {/*
          The hierarchy, inverted (D-067).

          The page used to open with a report and treat responding as an annotation on it. For a
          merchant that is backwards: **the report is context and responding is the task.** They
          did not ask for this document and will not read it as one — they are here because
          someone told them their storefront was screened and they have something to say about it.

          So the header states the ask, the count leads it, and the findings where a response is
          worth most are surfaced before the report rather than buried inside it.
        */}
        <div className="eyebrow">Screening report · {opened.merchantDomain}</div>
        <h1>Your response</h1>

        <p className="sub">
          {/*
            "The team reviewing your account", not "the underwriting team" (D-067). A merchant who
            does not know an underwriting team exists should not have to infer one to understand
            the sentence. The email keeps the fuller phrasing, where the register suits it.

            The last sentence says what Mintro is and is not, before any finding is read. A merchant
            reaching this page from a forwarded link has no idea who Mintro is, and the natural
            assumption about a company that just screened their storefront is that it decides
            something. It does not, and the page says so first rather than leaving them to infer it
            from the absence of a verdict.
          */}
          The team reviewing your account asked Mintro to screen your public pages against the
          research-use-only peptide standards. This is what was observed, with the capture
          behind each one. Mintro reports what it observed; it does not underwrite the account or
          decide the outcome.
        </p>

        <p className="sub">
          {/*
            "or none" comes in the second sentence, before anything asks them for anything.

            Frank's constraint: never imply that an unanswered finding is a failure or an
            admission. A merchant may reasonably have nothing to add to an observation they accept,
            and nothing on this page counts silence back at them.
          */}
          <strong>{invited.length} observations are open for your response.</strong> You can
          respond to any of them, or none. What you write is recorded exactly as you write it,
          shown as yours, and passed to the team reviewing your account with the report. Mintro
          does not edit it, shorten it, or reply to it.
        </p>

        <p className="sub">
          This link works until {opened.expiresAt.slice(0, 10)}. It can be forwarded — whoever
          responds says who they are, and each response is shown against the address given when it
          was written.
        </p>

        <p className="sub">
          {/* D-065, and the agent because a forwarded merchant has no Mintro contact of their own. */}
          Questions about this request, or want to confirm it is genuine? Contact your usual point
          of contact at Mintro, or the agent who sent this to you.
        </p>

        <Identify identity={identity} onIdentify={identify} onForget={forgetIdentity} />

        {/*
          The report as the analyst and IQwallet see it — the same component, the same evidence.
          `commentBox` is the only thing this view adds.
        */}
        {/*
          No `actions` prop, and that is the fix rather than an omission (D-066).

          This page is anonymous: anyone holding a forwarded link is here. Every operator action
          acts on Mintro's behalf, and *Send to IQwallet* would let a merchant transmit their own
          screening report to an underwriter. It was on this page because the props were required
          and no-op handlers satisfied them.
        */}
        {/*
          No `commentaryOf` either, and for a reason of the same kind (D-067).

          `MerchantResponse` is written for an underwriter: it explains what a blank space means —
          *"the merchant has not opened the report"*, *"identified themselves as X, and left no
          comment on it"*. Rendering it here narrates the reader's own behaviour back at them,
          finding by finding, on a page whose one rule is never to imply that saying nothing is a
          failure.

          Their own words are not lost: `CommentBox` shows what they have already written, above
          the box they would add to.
        */}
        {/*
          The report, in the report's own order (D-209).

          Same sequence, same bands, same statistics, same headings as the analyst's copy and the
          PDF. Everything this page adds is additive — the responder's email above, a box on
          anything that takes one — and nothing is reordered, summarised or promoted because the
          reader is the merchant. A page that rearranged the document for them would make their copy
          a different document from the one an underwriter reads.
        */}
        <ReportView
          surface="merchant"
          report={opened.report}
          access={access}
          {...(opened.report.attestationQuestions === undefined
            ? {}
            : {
                questionsForm: (
                  <AttestationForm
                    questions={opened.report.attestationQuestions}
                    answers={answers}
                    identified={identity !== null}
                    onAnswer={answer}
                  />
                ),
              })}
          eyeCommentBox={() => (
            <CommentBox
              body={bodyOf(EYE_TEST_SUBJECT, undefined)}
              onChange={(next) =>
                setDrafts((existing) => new Map(existing).set(keyOf(EYE_TEST_SUBJECT, undefined), next))
              }
              onBlur={() => autosave(EYE_TEST_SUBJECT, undefined)}
              savedAt={savedAt.get(keyOf(EYE_TEST_SUBJECT, undefined))}
              existing={comments.filter((comment) => comment.subject === 'eye-test')}
              identified={identity !== null}
            />
          )}
          commentBox={(finding, ordinal) => (
            <CommentBox
              key={`${finding.ruleId}-${ordinal ?? 'x'}`}
              body={bodyOf(finding.ruleId, ordinal)}
              onChange={(next) =>
                setDrafts((existing) => new Map(existing).set(keyOf(finding.ruleId, ordinal), next))
              }
              onBlur={() => autosave(finding.ruleId, ordinal)}
              savedAt={savedAt.get(keyOf(finding.ruleId, ordinal))}
              existing={commentaryOf(finding, ordinal).comments}
              identified={identity !== null}
            />
          )}
        />

        {/*
          After the findings, in the same place the section sits in the report an underwriter
          reads — so a merchant who later sees the document finds their answers where they left
          them (D-134).

          Rendered from the run's own snapshot of the questions rather than from the current rule
          set: they must be asked exactly what the report will show them as having been asked.
        */}
        <ResponseFooter
          identified={identity !== null}
          submitControl={submitControl}
          maySubmit={maySubmit}
          submittedAs={mySubmission}
          resubmitted={mySubmissions.length > 1}
          mostRecentInvited={opened.invited[opened.invited.length - 1]}
          busy={saving}
          note={saveNote}
          problem={saveProblem}
          onSave={() => void saveAll()}
          onSubmit={() => void submitRound()}
        />
      </main>
    </div>
  );
}

/**
 * Saving, and saying you are finished (D-143, D-144).
 *
 * Two controls with two different meanings, and the difference is the whole of what this component
 * has to communicate. **Save is about the words**: they are in the database. **Submit is about the
 * person**: they have said what they have to say. Neither closes anything, neither locks anything,
 * and the round is over when the operator decides it is (D-148).
 *
 * ## Nothing here is described as restricted
 *
 * Submit appears for the addresses Mintro sent the report to and not for anyone else. That is a
 * display convention (D-144) — the address was typed into a box on this page and nothing verifies
 * it — so the copy explains *who will submit* rather than implying anyone was refused. "Only the
 * authorised recipient may submit" would be a claim about an assurance this page does not provide.
 *
 * ## And nothing here counts silence
 *
 * No "you have 4 unanswered", no progress bar, no warning about leaving. A merchant may reasonably
 * have nothing to add to an observation they accept (D-067), and a footer that totted up their
 * blanks would be the one place on this page that argued with that.
 */
function ResponseFooter({
  identified,
  submitControl,
  maySubmit,
  submittedAs,
  resubmitted,
  mostRecentInvited,
  busy,
  note,
  problem,
  onSave,
  onSubmit,
}: {
  readonly identified: boolean;
  /**
   * The Submit button's label, or null for no button (D-151).
   *
   * Null covers two different situations that both mean *there is nothing to submit*: this identity
   * was not one Mintro wrote to, or they have already submitted and written nothing since. The copy
   * below tells them apart; the control does not exist in either.
   */
  readonly submitControl: string | null;
  /**
   * Whether this identity is one Mintro wrote to (D-144).
   *
   * Distinct from `submitControl`, and both are needed: after somebody submits with nothing new to
   * add, the control goes away while they remain invited. Collapsing the two would tell a merchant
   * who had just submitted that somebody else would be submitting on their behalf.
   */
  readonly maySubmit: boolean;
  readonly submittedAs: { readonly identifiedAs: string; readonly submittedAt: string } | undefined;
  /** Whether they have submitted more than once, so the confirmation can say so. */
  readonly resubmitted: boolean;
  readonly mostRecentInvited: string | undefined;
  readonly busy: boolean;
  readonly note: string | null;
  readonly problem: string | null;
  readonly onSave: () => void;
  readonly onSubmit: () => void;
}): JSX.Element {
  return (
    <div className="card rfoot">
      {/*
        The persistent line, always visible and never conditional on anything having been saved yet.

        It is the answer to the question a text box on someone else's website always raises — *is
        this going anywhere?* — and it has to be readable before the first keystroke, which is
        exactly when a status line that only appears after a save is not there.
      */}
      <p className="rfoot-auto">Your answers save as you type.</p>

      <div className="rfoot-row">
        {/*
          Save is the primary act when it is the only one.

          The hierarchy was fixed, so a merchant who was forwarded the link — the common case, and
          the one with no Submit button — saw a single quiet control and no visual answer to "what
          do I press when I have finished". Where Submit is also rendered the ordering is right:
          Submit is the act, Save is secondary to it.
        */}
        <button
          className={`btn ${submitControl === null ? 'btn-primary' : 'btn-ghost'}`}
          onClick={onSave}
          disabled={busy || !identified}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>

        {submitControl !== null && (
          /*
            The same `!identified` guard as Save, and it is not redundant.

            It is unreachable today only because `maySubmit` happens to require an identity, so the
            two conditions were coupled without saying so — and a change to how the invited set is
            matched would have left a pressable Submit whose handler returns immediately, which
            reads as a button that does nothing.
          */
          <button className="btn btn-primary" onClick={onSubmit} disabled={busy || !identified}>
            {submitControl}
          </button>
        )}

        {note !== null && <span className="rfoot-note">{note}</span>}
        {problem !== null && <span className="cbox-problem">{problem}</span>}
      </div>

      {submittedAs !== undefined && (
        /*
          The confirmation reads the identity back.

          One forwardable link may be used by several people, and "Submitted" alone would leave a
          merchant who has just handed the laptop back unsure whose response was recorded. And it
          says the page is still open, because it is — the alternative is somebody with more to add
          believing they have missed their chance.
        */
        <p className="rfoot-done">
          Submitted as <strong>{submittedAs.identifiedAs}</strong>
          {resubmitted && ', and again since'}. You can keep adding — anything you add is saved.
        </p>
      )}

      {submittedAs !== undefined && submitControl !== null && (
        /*
          They have written something since submitting, and it has not been submitted (D-151).

          Stated as what is true of the two acts rather than as an instruction: the words are already
          stored, and submitting again is what puts the addition in front of the team. "You should
          submit again" would be directive, and the copy audit would catch it.
        */
        <p className="rfoot-who">
          What you have added since is saved. Submitting again lets the team reviewing your account
          know it is there.
        </p>
      )}

      {identified && !maySubmit && mostRecentInvited !== undefined && (
        <p className="rfoot-who">
          {mostRecentInvited} will submit this when it&rsquo;s complete.
        </p>
      )}

      {identified && !maySubmit && mostRecentInvited === undefined && (
        /*
          No transmitted invitation exists for this run, so there is no address to name.

          Said as Mintro's own gap rather than left as a missing button — the same discipline
          `comment_invites.delivery` exists for (D-064). Everything written here is still stored.
        */
        <p className="rfoot-who">
          Mintro has no record of who this report was sent to, so there is nobody to name here.
          Anything you write is still saved.
        </p>
      )}
    </div>
  );
}

/**
 * Who is responding (D-063).
 *
 * One field, asked once, before anything can be written. **Nothing verifies it** — no confirmation
 * mail, no code, no check that the address exists. The report says "identified themselves as" and
 * never presents the address as established, which is the same discipline as "recorded as
 * received, not verified by Mintro" on the comment itself.
 *
 * Verification is deliberately absent rather than missing: adding it would make Mintro the party
 * that established who spoke, and this is a supporting document, not a legal instrument.
 */
export function Identify({
  identity,
  onIdentify,
  onForget,
}: {
  readonly identity: { readonly email: string } | null;
  readonly onIdentify: (email: string) => Promise<string | null>;
  /**
   * Someone else is writing now, or the same person under a different address (D-071).
   *
   * Required, not optional: an address a merchant cannot change is one that will eventually be
   * attached to somebody else's words. Nothing already written is affected — each comment keeps
   * the address held when it was written.
   */
  readonly onForget: () => void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (identity !== null) {
    return (
      <div className="card ident ident-done">
        <span>
          Responding as <strong>{identity.email}</strong>. Each response below is recorded against
          this address.
        </span>
        {/*
          Stated as "someone else", not "log out". Nobody logged in — and the likeliest reason to
          press it is that the agent has handed the laptop to the merchant, which is the case the
          whole per-comment attribution model exists for (D-063).
        */}
        <button className="ident-change" onClick={onForget}>
          Not you? Enter your email
        </button>
      </div>
    );
  }

  return (
    <div className="card ident">
      <label className="flabel" htmlFor="ident">
        Your email address
      </label>
      {/*
        "the team reviewing your account", and no "Mintro does not check it" (D-067).

        The disclaimer was true and told the reader nothing they could use, while undercutting the
        ask at the exact moment it is made. The self-declared framing belongs in the **report** —
        "identified themselves as", never "from" — where it informs the underwriter's reading of a
        response rather than discouraging one.
      */}
      <p className="fhint">
        Needed before you can respond, so the team reviewing your account can see who answered.
        Each response is shown against the address you give.
      </p>
      <div className="queue-row">
        <input
          className="input"
          id="ident"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button
          className="btn btn-primary"
          disabled={busy || !email.includes('@')}
          onClick={() => {
            setBusy(true);
            setProblem(null);
            void onIdentify(email.trim()).then((failure) => {
              setBusy(false);
              setProblem(failure);
            });
          }}
        >
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </div>
      {problem !== null && <div className="err" style={{ marginTop: 12 }}>{problem}</div>}
    </div>
  );
}

/**
 * The box.
 *
 * A textarea and a button. **No validation, no character limit, no structure, no placeholder
 * suggesting what to write** — a merchant writes whatever they want or nothing, and a prompt is a
 * suggestion about content.
 *
 * Submitting adds; it never replaces. An earlier response stays visible above the box with its
 * time, because it is already part of the document IQwallet may have read (D-002).
 */
function CommentBox({
  body,
  onChange,
  onBlur,
  savedAt,
  existing,
  identified,
}: {
  /**
   * What is in the box, held by the page (D-147).
   *
   * Controlled rather than local, because Save is one button for the whole page and a box that kept
   * its own text would be one the button could not reach. It starts from what this identity last
   * stored, so a refresh returns them to their own words rather than to an empty box beside them.
   */
  readonly body: string;
  readonly onChange: (next: string) => void;
  /** Autosave. Writes nothing when the text is unchanged — see `autosave`. */
  readonly onBlur: () => void;
  /** When this field was last confirmed stored, from the database's clock. */
  readonly savedAt: string | undefined;
  readonly existing: readonly MerchantComment[];
  /** Until someone says who they are, the box is readable but not writable. */
  readonly identified: boolean;
}): JSX.Element {
  return (
    <div className="cbox">
      {existing.length > 0 && (
        <div className="cbox-prior">
          {existing.map((comment, index) => (
            <p key={`${comment.submittedAt}-${index}`}>
              {/* Every entry names who wrote it: one link may be used by the agent and the
                  merchant both, and the report has to say which wrote what. */}
              <span className="cbox-when">
                {comment.identifiedAs} · {formatStamp(comment.submittedAt)}
              </span>
              {comment.body}
            </p>
          ))}
          <p className="cbox-hint">
            Anything you add is kept alongside what is already here, not in place of it.
          </p>
        </div>
      )}

      <label className="flabel" htmlFor={`c-${existing.length}`}>
        {existing.length > 0 ? 'Add to your response' : 'Your response'}
        {/*
          "optional" on every box, always (D-067).

          Frank's constraint: never imply that an unanswered finding is a failure or an admission.
          A merchant may reasonably have nothing to add to an observation they accept. This is the
          per-finding half of the header's "or none" — the header states it once and this states it
          where the decision is actually made.
        */}
        <span className="flabel-opt">optional</span>
      </label>
      {/*
        A placeholder, reversing this file's earlier rule against one (D-067).

        The old comment said a placeholder is a suggestion about content. That was right for a
        blank box on an annotation surface and wrong here: the page's job is to make responding
        the task, and an unlabelled empty box beside a compliance observation reads as a demand to
        justify yourself. A question that can be answered plainly lowers that.

        **"How does your site handle this" and never "how do you comply".** Asking a merchant to
        state compliance solicits a compliance claim, and hard constraint 7 says Mintro does not
        collect or transmit those — Frank's own "does or will comply" was overruled on that
        ground. The question asks what they do; the reader draws the conclusion.
      */}
      <textarea
        className="input cbox-input"
        id={`c-${existing.length}`}
        rows={4}
        value={body}
        disabled={!identified}
        placeholder={identified ? 'How does your site handle this, now or in future?' : ''}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {!identified && (
        <p className="cbox-hint" style={{ marginTop: 6 }}>
          Give an email address at the top of the page to respond.
        </p>
      )}

      {/*
        No button here any more, and that is the change rather than an omission.

        The box used to carry "Save response", which made saving a per-field act somebody could
        forget on the field they cared about most. It now saves when the field loses focus, and the
        page carries one Save for the whole document — so there is nothing left in this box that a
        person has to remember to press.

        The confirmation stays local, because *this field is stored* is a fact about this field.
      */}
      {savedAt !== undefined && <p className="cbox-saved">Saved · {formatClock(savedAt)}</p>}
    </div>
  );
}
