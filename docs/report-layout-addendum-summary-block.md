# Report layout — addendum: the summary block

Follows docs/report-layout-design.md. Written after Frank read the first draft (2026-09-09):
content ratified, presentation to change. Supersedes the memo's "no bar, no number" line for the
spectrum.

## Principle

One screen tells the reader what Mintro concluded. The scroll below is where they check it.
Nothing in the summary block says anything the detail below does not; nothing below repeats the
summary in prose.

## The block, top to bottom

### Row 1 — Placement

Left: a five-position spectrum strip, positions labeled Consumer retail · Consumer-leaning ·
Mixed · Research-leaning · Research supplier, the merchant's position marked and filled. Color
runs warm at the consumer end to cool at the research end using the existing report palette; the
marker is the only saturated element in the row.

Right: the recommended placement as a single badge, Referred out / International / Domestic. If
referred out, the badge is the alert color and the legality item that fixed it appears beneath.

### Row 2 — Legality and routing, side by side

Legality: one badge. "No legality items observed" with a check icon, and beneath it a count of
legality rules not observed if any ("2 not observed"). If a violation: the rule title, alert
color, a link to its capture.

Routing: five cells in a row, one per condition, in the data's order. Each cell is an icon and
the condition's short label. Icons: filled check for Met, hollow cross for Not met, dash in a
circle for Not observable. Not met cells carry the condition's short label in the alert color;
these are the domestic path and should be the second thing the eye lands on after the badge.

### Row 3 — Angles

Seven chips, one per angle, in the angle set's order. Each chip: the angle title, a lean dot in
the lean's color (consumer warm, neutral grey, research cool), and one line drawn from the
paragraph's first sentence, truncated. Heavy evidence present in the angle's citations adds a
small weight marker to the chip. Clicking a chip scrolls to the angle's detail.

### Row 4 — Placement paragraph

The 100-word paragraph, full width, with citation chips inline. This is the only prose in the
summary block.

## Below the block

Sections 2 to 7 of the layout memo, with two rendering rules already ruled:

- Under an angle, the citation list shows findings with observed states only; not_evaluable
  findings collapse to one line with a count.
- Shore-ups render for Mixed, Research-leaning and Research supplier; absent for the two consumer
  positions.

Handles in prose (F16, E18, Y8) render as chips resolved through the stored mapping: rule title
for F, page URL host and path for E, rubric question for Y, angle title for A. Each chip opens
the capture or scrolls to the finding.

## What the block must not do

- No score, percentage or count of passing rules anywhere in it.
- No pricing vocabulary (the validator already refuses it in placement and routing).
- No second summary: the angle chips carry first sentences, not new text.

## Color and icon constraints

Use the report's existing palette and iconography; the summary block should read as part of the
same document the findings render in, not a dashboard bolted on. If the palette has no warm/cool
pair suitable for the spectrum, propose one in the halt diff rather than inventing it silently.

## Operator editor

The editor renders this same component in edit mode: paragraph, leans, placement, routing
statuses and shore-ups are editable in place; the block re-renders on edit; publish re-validates.
The operator sees exactly what the reader will see.
