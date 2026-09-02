/**
 * What a guard renders (D-229, D-239).
 *
 * A partner or host member on `/people` or `/access-log`, or a partner on a Documents Check URL
 * they hold no capability for.
 *
 * ## Not a 404, and not a description
 *
 * A 404 lies about something that plainly exists, and a reader who catches the lie stops believing
 * the rest of the tool's messages. So it says the thing is not available to them.
 *
 * And it says **only** that. No merchant domain, no run state, no organisation name, nothing about
 * what sits behind the URL — confirming which merchant is behind an id is precisely the leak the
 * scoping exists to prevent, and a helpful "you don't have access to Partner A's screening of
 * shop.example" would hand over both facts while apologising.
 *
 * The link back is to their own runs, which is the one place they can certainly go.
 */

export function NotAvailable({ backTo = '/' }: { readonly backTo?: string }): JSX.Element {
  return (
    <div className="shell">
      <main className="main">
        <div className="na">
          <span className="na-brand">Mintro</span>
          <h1 className="na-head">This isn’t available to you</h1>
          {/* Nothing about what is behind the URL. See the header. */}
          <p className="na-body">Whatever you were looking for, it isn’t something this account can open.</p>
          <a className="btn btn-ghost" href={backTo}>
            Back to your runs
          </a>
        </div>
      </main>
    </div>
  );
}
