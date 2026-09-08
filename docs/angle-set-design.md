# Angle set — Layer 2 evaluation

Design memo for ratification. Follows D-256. No code implied yet.

## What an angle is

A question about the business, the reasoning for why a research supplier and a consumer retailer
would answer it differently, and the evidence that feeds it. The AI writes one short reasoned
paragraph per angle, citing only captured evidence, and gives the angle a lean: research, neutral,
or consumer. Placement on the spectrum is a judgment across the angles, not a sum of leans. Two
strong consumer angles can outweigh five neutral ones.

Evidence comes from three sources, all cited the same way: a rule finding from the standards, an
observation not bound to any rule, or an inference the AI states explicitly ("call for wholesale
rates implies the posted rates are retail").

## The seven angles

### 1. Who the site is talking to

Question: is the copy and imagery addressed to a lab or to a person who will use the product?

Reasoning: a supplier writes to a buyer who already knows what the compound is. A retailer has to
sell the outcome. Second-person benefit language, lifestyle imagery, "how it works" explainers,
reviews and testimonials all exist to persuade an end user.

Evidence: suggestive lifestyle claims (heavy); testimonials, reviews, before/after (OFFS-002);
study citations pointed at benefit (PROD-009); marketing terms in names (NAME-002); imagery
register; FAQ content; tone of product descriptions.

### 2. What the products are for

Question: does the catalogue look like a research inventory or a consumer lineup?

Reasoning: a research supplier stocks what assays need. A retailer stocks what people want to
take: the GLP-1, cosmetic and recovery lineup, plus everything that helps them take it.

Evidence: therapeutic categories (NAME-001, heavy); route-of-administration labels (PROD-007,
heavy); dosing instructions (PROD-005, heavy); blends, stacks and combination products; capsules
(CATG-006); water, syringes and wipes (routing conditions, weighed here as well); internal codes
in place of chemical names; catalogue breadth and what is conspicuously absent (no reagents, no
controls, no reference standards).

### 3. How it sells

Question: is the commerce built for a lab placing an order or a person buying a supply?

Reasoning: labs buy in research quantities at wholesale pricing with minimums. Consumers buy one
vial, want a discount, and come back monthly. The commercial mechanics reveal the customer even
when the copy does not.

Evidence: default pricing posture and whether wholesale is the norm or an option (inference);
vial sizes and multi-pack structure; bundle discounts, coupon codes, loyalty points,
subscriptions; order minimums (routing condition, weighed here as well); refund and chargeback
policy (PAY-003); payment methods offered.

### 4. Who it lets buy

Question: does anything on the site require the buyer to be a research entity?

Reasoning: a supplier that means "research only" has a mechanism for it. A retailer has a checkbox.

Evidence: registration gate and its contents (GATE-002/003/005, routing condition, weighed here as
well); terms content (GATE-004/007); institution capture; B2B mechanics such as invoicing, purchase
orders, tax-exempt handling; age gate and whether the stated ages agree.

### 5. Does it operate like a supplier

Question: is the back end that of a chemical supplier or a storefront?

Reasoning: real suppliers have lots, COAs, storage conditions, a shipping policy and a legal entity
behind them. Dropshipped retail has product cards.

Evidence: COA presence, freshness, lab identity, format (COA-001 to COA-006); CAS, formula,
weight, storage on product pages (PROD-001 to PROD-004); published shipping policy and its scope
(FULF-001, and unbound observations such as "ships anywhere in North America"); contact and entity
information; adult-signature and packing-slip practices where visible.

### 6. What it does off-site

Question: where does the traffic come from, and what tone does the brand carry elsewhere?

Reasoning: research suppliers do not need influencers. Off-site posture is the highest-risk area in
the standards for a reason.

Evidence: affiliate program (routing condition, weighed here as well); influencer or sponsored
content where visible on-site; social links and link policy (OFFS-003); tone of any social preview
captured. This angle is crawl-limited. The report must say what was not looked at rather than
infer from silence.

### 7. Does the story hold together

Question: where does the stated research-only position contradict observed behavior?

Reasoning: this is the angle that stops a merchant scoring their way in. Disclaimers on every
page plus a "Weight Loss" category is not compliance; it is a contradiction, and the contradiction
is the finding.

Evidence: anything from angles 1 to 6 set against the disclaimer, terms and any research-only
statement. Also internal inconsistencies: two ages, a research-only footer over a review widget,
a stated shipping scope the policy page does not match.

## What the AI produces

1. One paragraph per angle with lean and cited evidence. Angles with nothing observed say so.
2. Placement: one paragraph placing the business on the spectrum and naming the two or three
   angles that drove it.
3. Recommended placement today: referred out, international, or domestic.
4. Routing conditions: each of the six stated as met, not met, or not observable, with the
   evidence.
5. Shore-ups: drafted only for merchants placed on the research side. Left empty otherwise.

The operator edits all five before anything leaves. Layer 1 legality results sit above this and, if
any fail, the AI still drafts the angles for the operator's record but the recommendation is fixed
at referred out.

## Guardrails

- Cite only captured evidence. No claim without a capture or an explicit inference label.
- Declare what the crawl could not see. Angle 6 in particular.
- Heavy evidence is named as such in the draft so the operator sees the pull.
- No pricing, no cost comparison between solutions, anywhere.
- Shore-ups are never drafted for a business placed on the consumer side. The routing conditions
  are still listed for it, as facts, without a path.

## CoMo Peptides under this model

Worth stating plainly: CoMo stocks HCG with a published lot. Under D-256 that is Layer 1 and the
evaluation stops at referred out. The angles would still be drafted for the record, and they would
show a business with strong product data (angle 5 leans research), an open catalogue with no gate
(angle 4 leans consumer), blends and internal codes (angle 2 leans consumer), and a shipping
statement the policy does not back (angle 7). A useful test case precisely because the checklist
version led with four blockers and never said which one actually mattered.

## For ratification

The seven angles, the five outputs, and the guardrails. Design of the report layout and the AI
prompt structure follows once these hold.
