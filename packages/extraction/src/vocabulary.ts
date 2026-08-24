/**
 * The closed field vocabulary.
 *
 * **Derived from `docs/CHECK-INVENTORY.md` §6 — what the v1 checks actually read, nothing more.**
 * Every entry names the checks that consume it in `readBy`, and `vocabulary.test.ts` asserts that
 * list is non-empty for every field. That assertion is the guard against the failure D-086
 * describes: the surveyed app carries ~70 fields keyed to its own `document_requests` titles,
 * inherited wholesale, and nothing in it can say which of them anything reads.
 *
 * Deferred checks contribute nothing. C-20 (owner residential address) and D-05 (refund rate) are
 * marked `def` in the inventory, so `owner_residential_address` and `refund_amount` are **not**
 * here. They arrive with the checks that read them, under a decision number.
 *
 * Fields from §3's "Yields" column that no §6 check reads are also absent — W-8BEN's country and
 * TIN are the clearest case. That is the instruction followed literally, and it is flagged in the
 * build report rather than quietly resolved.
 */

export type FieldKind =
  /** Free text: names, addresses, institutions. Fuzzy comparison downstream (D-099). */
  | 'text'
  /** A run of digits, possibly punctuated. Exact comparison downstream (D-099). */
  | 'digits'
  | 'date'
  | 'money'
  | 'number'
  | 'percent';

export interface FieldSpec {
  readonly id: string;
  readonly kind: FieldKind;
  /** True where a document can carry several — owners, principals. Occurrences get an `index`. */
  readonly repeated: boolean;
  /** Inventory §6 check ids that read this field. Never empty; asserted in tests. */
  readonly readBy: readonly string[];
  /**
   * Label forms that may introduce this value on a rendered page.
   *
   * These locate the *label*, never the value — a check that finds its subject by matching the
   * compliant form of the subject is blind to every other form (D-014, constraint 9). A label is
   * page furniture and is safe to match literally; the value beside it is not.
   */
  readonly labels: readonly string[];
  /**
   * Substrings that may appear in an AcroForm field's *name*. Matched against a normalised form
   * of the name, so `business.legal_name`, `Business Legal Name` and `BUSINESS_LEGAL_NAME` are
   * one thing.
   */
  readonly formHints: readonly string[];
}

export const FIELDS: readonly FieldSpec[] = [
  {
    id: 'legal_name',
    kind: 'text',
    repeated: false,
    readBy: ['C-01', 'C-11', 'C-15', 'C-17'],
    labels: ['business legal name', 'legal business name', 'legal name', 'business/corporate name', 'corporate name', 'name of business', 'entity name', 'business name'],
    formHints: ['legalname', 'legal_name', 'businesscorporatename', 'corporatename', 'entityname', 'businessname', 'merchantname'],
  },
  {
    id: 'dba_name',
    kind: 'text',
    repeated: false,
    readBy: ['C-02', 'C-11', 'C-17'],
    labels: ['dba', 'dba name', 'doing business as', 'trade name', 'fictitious name', 'operating as'],
    formHints: ['dba', 'doingbusinessas', 'tradename', 'fictitiousname'],
  },
  {
    id: 'ein',
    kind: 'digits',
    repeated: false,
    readBy: ['C-03'],
    labels: ['ein', 'federal tax id', 'federal tax id number', 'employer identification number', 'federal ein', 'tax id', 'tin'],
    formHints: ['ein', 'federaltaxid', 'taxid', 'employerid', 'tin'],
  },
  {
    id: 'business_address',
    kind: 'text',
    repeated: false,
    readBy: ['C-04'],
    labels: ['business address', 'business legal address', 'legal address', 'mailing address', 'street address', 'address of business', 'principal business address'],
    formHints: ['businessaddress', 'legaladdress', 'mailingaddress', 'streetaddress'],
  },
  {
    id: 'entity_type',
    kind: 'text',
    repeated: false,
    readBy: ['C-05'],
    labels: ['entity type', 'type of entity', 'business type', 'type of merchant', 'organization type', 'tax classification', 'federal tax classification'],
    formHints: ['entitytype', 'businesstype', 'merchanttype', 'taxclassification', 'organizationtype'],
  },
  {
    id: 'formation_state',
    kind: 'text',
    repeated: false,
    readBy: ['C-06'],
    labels: ['state of formation', 'state of incorporation', 'state of organization', 'formed in', 'incorporated in', 'jurisdiction of formation'],
    formHints: ['stateofformation', 'stateofincorporation', 'stateoforganization', 'formationstate'],
  },
  {
    id: 'formation_date',
    kind: 'date',
    repeated: false,
    readBy: ['C-07'],
    labels: ['date of formation', 'formation date', 'date of incorporation', 'incorporated on', 'date organized', 'business start date'],
    formHints: ['formationdate', 'dateofincorporation', 'dateformed', 'businessstartdate'],
  },
  {
    id: 'routing_number',
    kind: 'digits',
    repeated: false,
    readBy: ['C-08', 'C-10'],
    labels: ['routing number', 'aba routing number', 'aba number', 'routing transit number', 'routing #', 'aba #', 'rtn'],
    formHints: ['routingnumber', 'abarouting', 'routingtransit', 'aba', 'rtn'],
  },
  {
    id: 'account_number',
    kind: 'digits',
    repeated: false,
    readBy: ['C-09'],
    labels: ['account number', 'bank account number', 'checking account #', 'account #', 'acct number', 'acct #', 'dda number'],
    formHints: ['accountnumber', 'bankaccount', 'checkingaccount', 'acctnumber', 'dda'],
  },
  {
    id: 'bank_name',
    kind: 'text',
    repeated: false,
    readBy: ['C-10'],
    labels: ['bank name', 'name of bank', 'financial institution', 'depository bank', 'banking institution', 'institution name'],
    formHints: ['bankname', 'financialinstitution', 'institutionname', 'depositorybank'],
  },
  {
    id: 'account_holder_name',
    kind: 'text',
    repeated: false,
    readBy: ['C-11'],
    labels: ['account holder', 'account holder name', 'name on account', 'name on bank account', 'account title', 'titled to'],
    formHints: ['accountholder', 'nameonaccount', 'accounttitle'],
  },
  {
    id: 'owner_name',
    kind: 'text',
    repeated: true,
    readBy: ['C-12', 'C-13', 'C-15'],
    labels: ['owner name', 'principal name', 'beneficial owner', 'officer name', 'member name'],
    formHints: ['ownername', 'principalname', 'beneficialowner', 'officername'],
  },
  {
    id: 'owner_ownership_pct',
    kind: 'percent',
    repeated: true,
    readBy: ['C-13', 'C-14'],
    labels: ['ownership', 'ownership %', 'ownership percentage', 'percent ownership', '% owned', 'equity %'],
    formHints: ['ownership', 'ownershippct', 'ownershippercent', 'percentowned', 'equity'],
  },
  {
    id: 'owner_dob',
    kind: 'date',
    repeated: true,
    readBy: ['C-16'],
    labels: ['date of birth', 'dob', 'birth date'],
    formHints: ['dateofbirth', 'dob', 'birthdate'],
  },
  {
    id: 'signer_name',
    kind: 'text',
    repeated: false,
    readBy: ['C-15'],
    labels: ['signer', 'signer name', 'name of signer', 'authorized signer', 'signed by', 'print name'],
    formHints: ['signername', 'authorizedsigner', 'signedby', 'printname'],
  },
  {
    id: 'domain_registrant',
    kind: 'text',
    repeated: false,
    readBy: ['C-17'],
    labels: ['registrant', 'registrant name', 'registrant organization', 'domain owner', 'registered to'],
    formHints: ['registrant', 'registrantname', 'domainowner'],
  },
  {
    id: 'domain_name',
    kind: 'text',
    repeated: false,
    readBy: ['C-17'],
    labels: ['domain', 'domain name', 'website', 'web address', 'url'],
    formHints: ['domainname', 'domain', 'website', 'weburl'],
  },
  {
    id: 'processor_name',
    kind: 'text',
    repeated: false,
    readBy: ['C-18', 'C-19'],
    labels: ['processor', 'processor name', 'current processor', 'prior processor', 'previous processor', 'last processor'],
    formHints: ['processorname', 'currentprocessor', 'priorprocessor', 'lastprocessor'],
  },
  {
    id: 'statement_period',
    kind: 'text',
    repeated: false,
    readBy: ['A-07', 'B-03', 'B-04', 'D-01'],
    labels: ['statement period', 'billing period', 'statement date', 'period ending', 'for the period'],
    formHints: ['statementperiod', 'billingperiod', 'periodending'],
  },
  {
    id: 'expiry_date',
    kind: 'date',
    repeated: false,
    readBy: ['A-06'],
    labels: ['expires', 'expiration', 'expiration date', 'exp date', 'valid through', 'valid until'],
    formHints: ['expirationdate', 'expirydate', 'expires', 'validthrough'],
  },
  {
    id: 'issue_date',
    kind: 'date',
    repeated: false,
    readBy: ['A-07'],
    labels: ['issue date', 'issued', 'date issued', 'issued on'],
    formHints: ['issuedate', 'dateissued'],
  },
  {
    id: 'signature_date',
    kind: 'date',
    repeated: false,
    readBy: ['A-05'],
    labels: ['date signed', 'signature date', 'dated'],
    formHints: ['signaturedate', 'datesigned'],
  },
  {
    id: 'page_marker',
    kind: 'text',
    repeated: true,
    readBy: ['A-02'],
    labels: [],
    formHints: [],
  },
  {
    id: 'processing_volume',
    kind: 'money',
    repeated: false,
    readBy: ['D-01'],
    labels: ['total volume', 'gross volume', 'total sales', 'sales volume', 'total processed', 'gross sales'],
    formHints: [],
  },
  {
    id: 'processing_transaction_count',
    kind: 'number',
    repeated: false,
    readBy: ['D-02', 'D-04'],
    labels: ['transaction count', 'number of transactions', 'total transactions', 'sales count'],
    formHints: [],
  },
  {
    id: 'processing_average_ticket',
    kind: 'money',
    repeated: false,
    readBy: ['D-02'],
    labels: ['average ticket', 'avg ticket', 'average transaction', 'average sale'],
    formHints: [],
  },
  {
    id: 'processing_high_ticket',
    kind: 'money',
    repeated: false,
    readBy: ['D-03'],
    labels: ['high ticket', 'highest ticket', 'largest transaction', 'maximum transaction'],
    formHints: [],
  },
  {
    id: 'chargeback_count',
    kind: 'number',
    repeated: false,
    readBy: ['D-04'],
    labels: ['chargeback count', 'number of chargebacks', 'chargebacks', 'total chargebacks'],
    formHints: [],
  },
  {
    id: 'chargeback_amount',
    kind: 'money',
    repeated: false,
    readBy: ['D-04'],
    labels: ['chargeback amount', 'chargeback total', 'chargebacks amount'],
    formHints: [],
  },
  {
    id: 'bank_deposits',
    kind: 'money',
    repeated: true,
    readBy: ['C-19'],
    labels: ['deposits', 'total deposits', 'total credits'],
    formHints: [],
  },
  {
    id: 'stated_monthly_volume',
    kind: 'money',
    repeated: false,
    readBy: ['D-01'],
    labels: ['estimated monthly volume', 'monthly volume', 'estimated monthly processing volume', 'anticipated monthly volume', 'projected monthly volume'],
    formHints: ['monthlyvolume', 'estimatedmonthlyvolume', 'processingvolume', 'annualvolume'],
  },
  {
    id: 'stated_average_ticket',
    kind: 'money',
    repeated: false,
    readBy: ['D-02'],
    labels: ['average ticket amount', 'estimated average ticket', 'average transaction amount', 'avg ticket amount'],
    formHints: ['averageticket', 'avgticket', 'averagetransactionamount'],
  },
  {
    id: 'stated_high_ticket',
    kind: 'money',
    repeated: false,
    readBy: ['D-03'],
    labels: ['high ticket amount', 'highest ticket amount', 'largest transaction amount', 'maximum ticket'],
    formHints: ['highticket', 'largesttransactionamount', 'maxticket'],
  },
  {
    id: 'stated_chargeback_rate',
    kind: 'percent',
    repeated: false,
    readBy: ['D-04'],
    labels: ['chargeback rate', 'estimated chargeback rate', 'chargeback ratio'],
    formHints: ['chargebackrate', 'chargebackratio'],
  },
];

export const FIELD_IDS: readonly string[] = FIELDS.map((f) => f.id);

const BY_ID = new Map(FIELDS.map((f) => [f.id, f]));

export function fieldSpec(id: string): FieldSpec | undefined {
  return BY_ID.get(id);
}

/** Lowercase, collapse runs of non-alphanumerics to single spaces, trim. For label matching. */
export function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Lowercase and strip everything non-alphanumeric. For AcroForm field names. */
export function normalizeFormName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Every label in the vocabulary, normalised.
 *
 * This exists for the guard in `extractText.ts`: a candidate value that is itself a known label is
 * not a value. That is not a hypothetical — it is the exact defect the survey measured, where a
 * label-adjacency harvester read `Merchant Name` and returned `"Merchant Address"`, the *next
 * label on the page*, as the business's legal name at confidence 0.90.
 */
export const ALL_LABELS: ReadonlySet<string> = new Set(
  FIELDS.flatMap((f) => f.labels).map(normalizeLabel),
);
