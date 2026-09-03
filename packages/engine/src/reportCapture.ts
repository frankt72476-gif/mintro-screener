/**
 * Where a captured report lives, and how to read a path back.
 *
 * One owner for the shape, for the same reason `commentLink.ts` owns the comment URL: this path is
 * **written by the worker and read somewhere else** — by the CI tripwire that fetches an old
 * capture and checks it still has no external references, and by anything that later has to say
 * which run a delivered link belongs to. The last URL shape stated in two places disagreed with
 * itself and would have sent a merchant to a sign-in screen holding the only token that report
 * would ever have (D-034).
 *
 * ## The path
 *
 *     <bucket>            reports
 *     <object key>        <run-id>/<token>.html
 *     read publicly as    reports/<run-id>/<token>.html
 *
 * The bucket is public-read and not listable (migration 0071), so **the token is the credential**.
 * The run id is in the path to group a run's captures under one prefix — which is what lets
 * retention and the purge path address them — and it is not a secret. Guessing one gets you
 * nowhere without the 43 characters after it.
 *
 * ## Why the token is not the comment token
 *
 * Different audiences, different surfaces. The comment link goes to the merchant; the report link
 * goes to IQwallet and the agent. Reusing one for both, or deriving one from the other, would put
 * the IQwallet-facing report one guess away from any merchant holding a comment link. They are
 * drawn independently — see `apps/worker/src/reportToken.ts`, and the test that holds it there.
 *
 * ## No relative paths, ever
 *
 * Nothing here builds a path fragment for a document to embed. A captured report contains no
 * relative URL of any kind: it is opened from a storage origin that is not the app's, and a
 * relative reference resolves against that origin to nothing.
 */

/** The bucket. Not `evidence` — that one is private and stays that way (0008). */
export const REPORT_BUCKET = 'reports';

/** One file per capture. */
export const REPORT_CAPTURE_EXTENSION = '.html';

/**
 * What a report token looks like: 32 bytes, base64url, unpadded — 43 characters.
 *
 * Stated here as well as at the point of generation because this is the module that has to refuse
 * a bad one, and refusing requires knowing the shape independently of whoever minted it.
 */
export const REPORT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Run ids are uuids. A run id with a `/` or a `.` in it would reshape the path. */
const RUN_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** A capture identified by the two parts of its key. */
export interface ReportCaptureRef {
  readonly runId: string;
  readonly token: string;
}

/**
 * The object key for a capture, inside `REPORT_BUCKET`.
 *
 * **Throws on a malformed token or run id rather than building the path anyway.** This is the one
 * function in the delivery path where a silent degradation is dangerous: an empty token yields
 * `<run-id>/.html`, which is a guessable key in a public bucket, and it would look like a working
 * link right up until someone else opened it. The write path is a job that is required to fail
 * loud; this is where it fails.
 */
export function reportObjectKey(runId: string, token: string): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`report capture: '${runId}' is not a run id — refusing to build a path from it`);
  }
  if (!isReportToken(token)) {
    throw new Error(
      'report capture: the token is not 32 bytes of base64url. The token is the only thing ' +
        'making this public path unguessable, so a malformed one is not written.',
    );
  }
  return `${runId}/${token}${REPORT_CAPTURE_EXTENSION}`;
}

export function isReportToken(token: string): boolean {
  return REPORT_TOKEN_PATTERN.test(token);
}

/**
 * The path the delivered link lands on, without a run or a token.
 *
 * Stated here and nowhere else. It is written in `netlify.toml`, composed into an email by the
 * worker, and rendered as a link by the app — three places, which is exactly the shape D-034 is
 * about. The last URL spelled out in two places disagreed with itself and would have sent a
 * merchant to a sign-in screen holding the only token that report would ever have.
 */
export const REPORT_LINK_PATH = '/r/';

/**
 * The link to give someone.
 *
 * Not the storage URL. The object lives at the storage endpoint; what is sent is this, proxied to
 * it — so the storage backend can change without invalidating a link already issued, and so a
 * third party is never handed the project ref.
 *
 * `origin` is tolerated with or without a trailing slash, for the same reason `commentLinkFor`
 * tolerates it: it comes from configuration, and a doubled slash is the kind of thing nobody
 * notices until somebody reports a dead link.
 */
export function reportLinkFor(origin: string, runId: string, token: string): string {
  if (!RUN_ID_PATTERN.test(runId) || !isReportToken(token)) {
    throw new Error('report capture: refusing to build a link from a malformed run id or token');
  }
  return `${origin.replace(/\/+$/, '')}${REPORT_LINK_PATH}${runId}/${token}`;
}

/**
 * The same link, from the stored object key.
 *
 * The key is what the database holds, so this is the form every caller actually has. Parsing it
 * here rather than at each call site keeps the one place that knows `<run>/<token>.html` means a
 * capture.
 */
export function reportLinkForKey(origin: string, storageKey: string): string {
  const ref = reportCaptureRefFromKey(storageKey);
  if (ref === null) {
    throw new Error(`report capture: '${storageKey}' is not a capture key`);
  }
  return reportLinkFor(origin, ref.runId, ref.token);
}

/** The run and token in a stored object key, or null if it is not one. */
export function reportCaptureRefFromKey(storageKey: string): ReportCaptureRef | null {
  const parts = storageKey.split('/');
  if (parts.length !== 2) return null;

  const [runId, file] = parts as [string, string];
  if (!file.endsWith(REPORT_CAPTURE_EXTENSION)) return null;

  const token = file.slice(0, -REPORT_CAPTURE_EXTENSION.length);
  if (!RUN_ID_PATTERN.test(runId) || !isReportToken(token)) return null;

  return { runId, token };
}

/**
 * The run and token in a captured-report URL, or null if it is not one.
 *
 * Matches on the tail of the path rather than on a whole URL, and treats the `.html` as optional,
 * because **the delivered URL is not the storage URL**. The object's canonical home is the storage
 * endpoint at `<run-id>/<token>.html`; what is sent to IQwallet is `/r/<run-id>/<token>` on a
 * Mintro origin, proxied to it — indirection, so the storage backend can change without
 * invalidating a link already issued, and so a third party is not handed the project ref.
 *
 * Two spellings of one capture, and both have to read back to the same run. A reader that knew
 * only the storage form would fail on every URL the system actually delivers.
 *
 * Null means *this is not a captured report URL*. It never means the capture is missing — that
 * question is answered by fetching it.
 */
export function reportCaptureRefFrom(url: string): ReportCaptureRef | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }

  const parts = path.split('/');
  const file = parts.pop();
  const runId = parts.pop();

  if (file === undefined || runId === undefined) return null;

  // The extension is optional: present on the storage object, absent from the delivered link.
  // Anything else after the token is a different kind of file and not ours to claim.
  const token = file.endsWith(REPORT_CAPTURE_EXTENSION)
    ? file.slice(0, -REPORT_CAPTURE_EXTENSION.length)
    : file;

  if (!RUN_ID_PATTERN.test(runId) || !isReportToken(token)) return null;

  return { runId, token };
}
