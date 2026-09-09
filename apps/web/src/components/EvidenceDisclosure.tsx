/**
 * Whether section 6 is open, and what it should scroll to when it opens.
 *
 * ## Why a context and not a prop
 *
 * The two ends are far apart. A finding chip is inside the summary block or an angle paragraph; the
 * section it opens is composed by the page and handed to `EvaluationReport` as an opaque appendix.
 * Threading a setter between them would put the evidence section's collapsed state into the props
 * of four components that have no other reason to know about it.
 *
 * ## No provider means open
 *
 * `useEvidenceDisclosure` returns `null` where nothing is controlling the section, and
 * `EvaluationEvidence` reads that as **open**. A collapsed section with no control able to open it
 * is a section nobody can reach — the "flag nothing renders" failure one layer along (D-246) — and
 * it would take every anchor in the document with it. The print path has no provider and wants
 * everything expanded anyway, which is the same answer for the same reason.
 *
 * ## The scroll is a request, not an action
 *
 * `reveal` records which rule was asked for; the section performs the scroll once it has rendered
 * the row, then clears it. A `scrollIntoView` at click time would run against an element that does
 * not exist yet — the section is still collapsed at the moment the chip is clicked.
 */

import { createContext, useCallback, useContext, useMemo, useState, type JSX, type ReactNode } from 'react';

export interface EvidenceDisclosure {
  readonly open: boolean;
  /** Opens or closes the section. The reader's own control. */
  readonly toggle: () => void;
  /** Open the section and ask it to scroll to this rule. */
  readonly reveal: (ruleId: string) => void;
  /** The rule the section owes a scroll, or `null`. */
  readonly pending: string | null;
  /** Called by the section once it has scrolled, so a later toggle does not scroll again. */
  readonly settle: () => void;
}

const Context = createContext<EvidenceDisclosure | null>(null);

export function useEvidenceDisclosure(): EvidenceDisclosure | null {
  return useContext(Context);
}

export function EvidenceDisclosureProvider({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const toggle = useCallback(() => {
    setOpen((was) => !was);
    // A reader closing the section is not asking to be scrolled anywhere when they reopen it.
    setPending(null);
  }, []);

  const reveal = useCallback((ruleId: string) => {
    setOpen(true);
    setPending(ruleId);
  }, []);

  const settle = useCallback(() => setPending(null), []);

  const value = useMemo(
    () => ({ open, toggle, reveal, pending, settle }),
    [open, toggle, reveal, pending, settle],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
