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
 * invited finding, submit. Nothing here can change a finding, and there is no code path from this
 * component to anything but `submit_merchant_comment`.
 */

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  commentaryFor,
  commentTokenFrom,
  invitesComment,
  type CommentVisit,
  type FindingCommentary,
  type MerchantComment,
  type ReportFinding,
  type ScreeningReport,
} from '@mintro/engine';
import { createEvidenceAccess } from '../lib/evidence.js';
import { ReportView } from './ReportView.js';
import { formatStamp } from '../lib/format.js';

/** `?comment=<token>` — the merchant's whole credential. */
export function commentToken(): string | null {
  // The shape lives in `@mintro/engine` and is stated in exactly one place. It was stated in two
  // once — the worker built a path and this read a query parameter — and an invitation would have
  // delivered a merchant to the analyst sign-in screen (D-034).
  return commentTokenFrom(window.location.href);
}

interface OpenedReport {
  readonly runId: string;
  readonly merchantDomain: string;
  readonly expiresAt: string;
  readonly report: ScreeningReport;
  readonly comments: readonly MerchantComment[];
  readonly visits: readonly CommentVisit[];
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
    Who is here (D-063).

    The link is forwardable and goes to the agent as often as to the merchant, so whoever lands
    says who they are before they can write. Held for this visit only: nothing is stored in the
    browser, because the next person to open this link on a shared machine is a different person.
  */
  const [identity, setIdentity] = useState<{ readonly visitId: string; readonly email: string } | null>(
    null,
  );

  /**
   * How many findings are ones the pages did not show either way (D-067).
   *
   * The same `invitesComment` predicate, narrowed to `not_evaluable` — so this is exactly the set
   * that carries a box, never the wider set of things nobody observed. `no_check_built` and
   * `not_retrieved` are gaps in what Mintro looked at, they carry no box, and the report labels
   * them as ours (D-046). Counting them here would promise a response this page does not offer.
   *
   * Derived from the report rather than passed in, so the callout and the section it points at
   * cannot come to mean different sets.
   */
  const nothingObserved = useMemo(
    () =>
      opened.report.categories
        .flatMap((category) => category.findings)
        .filter(
          (finding) =>
            finding.state === 'not_evaluable' &&
            invitesComment(finding.state, finding.notEvaluableKind),
        ).length,
    [opened.report],
  );

  const invited = useMemo(
    () =>
      opened.report.categories
        .flatMap((category) => category.findings)
        .filter((finding) => invitesComment(finding.state, finding.notEvaluableKind)),
    [opened.report],
  );

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
    return null;
  };

  const submit = async (finding: ReportFinding, ordinal: number | undefined, body: string) => {
    if (identity === null) return 'Please give an email address above before writing a response.';

    const { data, error } = await client.rpc('submit_merchant_comment', {
      p_token: token,
      p_rule_id: finding.ruleId,
      p_ordinal: ordinal ?? null,
      p_body: body,
      p_visit_id: identity.visitId,
    });

    const payload = data as { ok?: boolean; reason?: string } | null;
    if (error !== null || payload?.ok !== true) {
      return payload?.reason ?? 'That could not be saved just now. Please try again.';
    }

    setComments((existing) => [
      ...existing,
      {
        ruleId: finding.ruleId,
        ...(ordinal === undefined ? {} : { ordinal }),
        identifiedAs: identity.email,
        body,
        submittedAt: new Date().toISOString(),
      },
    ]);
    return null;
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
          */}
          The team reviewing your account asked Mintro to screen your public pages against the
          peptide research-use programme rule set. This is what was observed, with the capture
          behind each one.
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

        {nothingObserved > 0 && (
          <div className="card unseen">
            <h2 className="unseen-head">
              {nothingObserved} where your pages did not show one way or the other
              <a className="unseen-jump" href="#nothing-observed">
                Jump to these
              </a>
            </h2>
            {/*
              "did not show one way or the other" — not "nothing could be observed" (D-067).

              The narrower phrasing resolves a real overlap. Findings Mintro has not built a check
              for are also ones where nothing was observed, but they are gaps in what *we* looked
              at rather than in what the pages showed; they carry no box, and the report's
              four-column breakdown labels them as ours. A callout that swept them in would
              contradict it, and would promise a response this page does not offer.
            */}
            <p>
              For these, your public pages did not show either way — an order-handling practice, a
              page behind a login, a document not published.{' '}
              <strong>A response here adds more than anywhere else on this report</strong>, because
              there is nothing on the site for the team reviewing your account to read instead. You
              can describe how your site handles it now, or how you intend to.
            </p>
          </div>
        )}

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

        <Identify identity={identity} onIdentify={identify} />

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
        <ReportView
          report={opened.report}
          access={access}
          commentBox={(finding, ordinal) => (
            <CommentBox
              key={`${finding.ruleId}-${ordinal ?? 'x'}`}
              onSubmit={(body) => submit(finding, ordinal, body)}
              existing={commentaryOf(finding, ordinal).comments}
              identified={identity !== null}
            />
          )}
        />
      </main>
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
function Identify({
  identity,
  onIdentify,
}: {
  readonly identity: { readonly email: string } | null;
  readonly onIdentify: (email: string) => Promise<string | null>;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (identity !== null) {
    return (
      <div className="card ident ident-done">
        Responding as <strong>{identity.email}</strong>. Each response below is recorded against
        this address.
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
  onSubmit,
  existing,
  identified,
}: {
  readonly onSubmit: (body: string) => Promise<string | null>;
  readonly existing: readonly MerchantComment[];
  /** Until someone says who they are, the box is readable but not writable. */
  readonly identified: boolean;
}): JSX.Element {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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
        onChange={(event) => setBody(event.target.value)}
      />
      {!identified && (
        <p className="cbox-hint" style={{ marginTop: 6 }}>
          Give an email address at the top of the page to respond.
        </p>
      )}

      <div className="cbox-foot">
        <button
          className="btn btn-primary"
          disabled={busy || !identified || body.trim() === ''}
          onClick={() => {
            setBusy(true);
            setProblem(null);
            void onSubmit(body).then((failure) => {
              setBusy(false);
              if (failure === null) setBody('');
              else setProblem(failure);
            });
          }}
        >
          {busy ? 'Saving…' : 'Save response'}
        </button>
        {problem !== null && <span className="cbox-problem">{problem}</span>}
      </div>
    </div>
  );
}
