/**
 * The adult AI rule set and its source corpus (D-284, D-286, D-288).
 *
 * The counterpart of `ruleset-json.test.ts` for the second vertical: the committed file loads, agrees
 * with its corpus byte for byte, and carries the properties memo §5 (v0.3) rules on. Counts are pinned
 * here for the reason they are pinned there — a rule and its corpus line removed together leave two
 * files that agree with each other and are both shorter than intended.
 *
 * Also the two failures the corpus check exists to catch, against these files rather than a fixture:
 * a clause off by one character, and a corpus with nothing in it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  VERTICAL_FILES,
  checkAgainstCorpus,
  checkAgainstCorpusFile,
  citationsByRule,
  corpusClauseLines,
  loadRulesetFile,
  loadRulesetForVertical,
  senseOf,
} from '../src/index.js';
import { REPO_ROOT, RULESET_PATH } from './paths.js';

const ADULT_RULESET_PATH = resolve(REPO_ROOT, VERTICAL_FILES.adult_ai.ruleset);
const ADULT_CORPUS_PATH = resolve(REPO_ROOT, VERTICAL_FILES.adult_ai.corpus);
const adult = loadRulesetFile(ADULT_RULESET_PATH);
const corpusText = readFileSync(ADULT_CORPUS_PATH, 'utf8');

/** The rules memo §5 marks `present`. Every other adult rule is `absent`. */
const PRESENT = /^(AITD-00[1-3]|AIGATE-00[1-3]|AIPOL-00[1-7]|AIBILL-00[1-3])$/;

describe('rules/ruleset-adult-ai.json', () => {
  it('loads, at the version and date cluster 4 ships', () => {
    // 0.1.1: phrase-level term lists, AIGATE-003 retitled. 0.1.2: unambiguous single words and inflections.
    // 0.2.0: rules read several page types (cluster 2). 0.3.0: dom_feature rules (cluster 2).
    // 0.4.0: the attestation set, not-checked items and AIATT- manual rules (cluster 4, D-286).
    // 0.4.1: titles are noun phrases naming the thing looked for, with no surface (cluster 4b, D-286).
    // 0.5.0: each rule citing a source declares which way that source runs (cluster 4d, D-290).
    expect(adult.version).toBe('0.5.0');
    expect(adult.effective).toBe('2026-09-21');
    expect(adult.source_document).toBe('Adult AI public-rule excerpts v1');
  });

  it('carries exactly the observed rules, then one manual rule per attestation question', () => {
    // AIPOL-005 (incest) is absent: Mastercard Rules 5.12.7 does not name it, and no other source was
    // taken. Its id is left unassigned, not reused.
    expect(adult.rules.filter((rule) => rule.type !== 'manual').map((rule) => rule.id)).toEqual([
      'AIGATE-003',
      'AIPOL-001',
      'AIPOL-002',
      'AIPOL-003',
      'AIPOL-004',
      'AIPOL-006',
      'AITD-001',
      'AITD-002',
      'AIFEAT-001',
      'AIFEAT-002',
      'AIFEAT-003',
      'AIFEAT-004',
      'AIMKT-001',
      'AIMKT-002',
      'AICAT-001',
      'AICAT-002',
    ]);
    expect(adult.rules.filter((rule) => rule.type === 'manual').map((rule) => rule.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `AIATT-${String(i + 1).padStart(3, '0')}`),
    );
  });

  it('agrees with its corpus byte for byte, one clause line per quoting rule', () => {
    expect(checkAgainstCorpusFile(adult, ADULT_CORPUS_PATH)).toEqual([]);
    expect(corpusClauseLines(corpusText)).toHaveLength(11);
  });

  it('declares every rule as the memo rules: its source, auto tier, evidence, ordinary, a sense', () => {
    // Rules with no public source excerpt are Mintro's, rendered under the Mintro heading (D-138).
    // The AIATT- rules quote no excerpt either: each says what cannot be observed and which question asks.
    const MINTRO = /^(AIFEAT-00[134]|AIMKT-00[12]|AIATT-\d{3})$/;
    for (const rule of adult.rules) {
      expect(rule.source, rule.id).toBe(MINTRO.test(rule.id) ? 'mintro' : 'programme');
      // Manual rules are review_only by invariant, and resolve to not_evaluable: they never run.
      expect(rule.tier, rule.id).toBe(rule.type === 'manual' ? 'review_only' : 'auto_fail');
      expect(rule.evaluation_tier, rule.id).toBe('evidence');
      expect(rule.weight, rule.id).toBe('ordinary');
      expect(rule.sense, rule.id).toBe(PRESENT.test(rule.id) ? 'present' : 'absent');
    }
  });

  it('reads the page types cluster 2 scoped each rule to (D-284)', () => {
    const scope = Object.fromEntries(
      adult.rules.filter((r) => r.type === 'text_match').map((r) => [r.id, r.type === 'text_match' ? r.params.surfaces : undefined]),
    );
    expect(scope).toEqual({
      'AIGATE-003': ['homepage', 'terms'],
      'AIPOL-001': ['terms', 'guidelines'],
      'AIPOL-002': ['terms', 'guidelines'],
      'AIPOL-003': ['terms', 'guidelines'],
      'AIPOL-004': ['terms', 'guidelines'],
      'AIPOL-006': ['terms', 'guidelines'],
      'AITD-001': ['footer', 'removal'],
      'AITD-002': ['terms', 'removal'],
    });
    // The runner that reads several page types is Layer 3's. Manual rules are reached by no crawl.
    expect(adult.rules.every((r) => (r.type === 'manual' ? r.layer === null : r.layer === 3))).toBe(true);
  });

  it('reads the feature rules on the page types cluster 2 commit 3 names', () => {
    const scope = Object.fromEntries(
      adult.rules.filter((r) => r.type === 'dom_feature').map((r) => [r.id, r.type === 'dom_feature' ? r.params.surfaces : undefined]),
    );
    expect(scope).toEqual({
      'AIFEAT-001': ['create', 'generate', 'pricing', 'docs'],
      'AIFEAT-002': ['create', 'generate', 'pricing', 'docs'],
      'AIFEAT-003': ['homepage', 'pricing', 'generate', 'docs'],
      'AIFEAT-004': ['create', 'generate', 'docs'],
      'AIMKT-001': ['homepage', 'pricing'],
      'AIMKT-002': ['homepage', 'footer'],
      'AICAT-001': ['homepage', 'create', 'generate', 'library'],
      'AICAT-002': ['homepage', 'create', 'generate', 'library'],
    });
  });

  it('titles every rule as the thing looked for, never as a verdict', () => {
    for (const rule of adult.rules) {
      expect(rule.title, rule.id).not.toMatch(/\b(fail|failed|pass|passed|blocker|clean|compliant|recommend)\w*/i);
    }
  });

  it('names no surface in a title, because the report\'s sentence supplies it once (cluster 4b)', () => {
    /*
      "Minors named in the terms" read as "Minors named in the terms \u2014 observed on the terms
      document": the surface twice in one sentence, and wrong the moment a rule reads two. The title
      is the thing looked for; where it was looked for is the report's to say, from what the run read.
    */
    for (const rule of adult.rules) {
      // "Minor-coded terms" is words on a page, not the terms document: the phrasing is what gives a
      // surface away — "in the terms", "on public pages", "footer".
      expect(rule.title, rule.id).not.toMatch(/\b(?:footer|homepage|website)\b|\b(?:in|on) the\b|\bpages?\b/i);
    }
  });

  it('carries the titles of the 0.4.1 pass, one noun phrase each', () => {
    const titles = Object.fromEntries(
      adult.rules.filter((rule) => rule.type !== 'manual').map((rule) => [rule.id, rule.title]),
    );
    expect(titles).toEqual({
      'AIGATE-003': 'Non-human disclosure statement',
      'AIPOL-001': 'Prohibition of depicting minors',
      'AIPOL-002': 'Prohibition of real-person likeness',
      'AIPOL-003': 'Prohibition of non-consensual content',
      'AIPOL-004': 'Prohibition of bestiality',
      'AIPOL-006': 'Prohibition of mutilation or gore',
      'AITD-001': 'Content removal route',
      'AITD-002': '48-hour removal commitment',
      'AIFEAT-001': 'Upload control for images',
      'AIFEAT-002': 'Face-swap or face-consistency language',
      'AIFEAT-003': 'Video generation language',
      'AIFEAT-004': 'Model selection or LoRA language',
      'AICAT-001': 'Minor-coded terms',
      'AICAT-002': 'Real-person likeness terms',
      'AIMKT-001': 'Filter-removal marketing language',
      'AIMKT-002': 'Affiliate program',
    });
  });

  it('carries no placeholder', () => {
    // A rule whose detector lands in a later cluster is left out until then (Frank, 2026-09-18).
    expect(readFileSync(ADULT_RULESET_PATH, 'utf8')).not.toMatch(/cluster \d|detector lands|TODO|placeholder/i);
  });

  it('matches phrases, never the standalone words that match a privacy section or any AI homepage', () => {
    /*
      A present-sense rule reads "Observed" when a term appears. "children" appears in every privacy
      policy's section on children's data, and "chatbot" on every AI companion homepage — so either as
      a standalone term would report the rule observed on a page that says nothing on the subject
      (Frank, 2026-09-18).
    */
    const dropped = ['child', 'children', 'chatbot', 'ai companion'];
    for (const rule of adult.rules) {
      if (rule.type !== 'text_match') continue;
      const terms = (rule.params.terms ?? []).map((term) => term.toLowerCase());
      for (const word of dropped) expect(terms, rule.id).not.toContain(word);
    }
  });

  it('carries memo §8\'s twelve questions, in order, asking what the merchant does (D-067)', () => {
    expect(adult.attestations.map((q) => q.id)).toEqual([
      'model-provider',
      'output-moderation',
      'csam-detection',
      'user-age-assurance',
      'character-age-constraints',
      'reference-images',
      'creator-verification',
      'takedown-volume',
      'network-registration',
      'app-stores',
      'chargeback-ratio',
      'state-law-posture',
    ]);
    for (const q of adult.attestations) {
      // Asks what they do. Never whether they comply, never a threshold, never a verdict.
      expect(q.question, q.id).toMatch(/^(What|How|Which|Can|If)\b/);
      expect(q.question, q.id).toMatch(/\?/);
      expect(q.question, q.id).not.toMatch(/\b(compl(y|ies|iance|iant)|adequate|sufficient|acceptable|meet|threshold|fail|pass|recommend)\w*/i);
      // No authority and no severity: memo §8 gives neither, and D-286 records no published standard.
      expect(q.authority, q.id).toBeUndefined();
      expect(q.sev, q.id).toBeUndefined();
    }
  });

  it('names, in each AIATT- rule, the question that covers it, one rule per question', () => {
    const manual = adult.rules.filter((rule) => rule.type === 'manual');
    expect(manual).toHaveLength(adult.attestations.length);
    manual.forEach((rule, i) => {
      const question = adult.attestations[i]!;
      if (rule.type !== 'manual') throw new Error('unreachable');
      // Verbatim, so a question reworded without its rule fails here rather than in a report.
      expect(rule.params.reason, rule.id).toBe(`The attestation question \u201c${question.question}\u201d asks the merchant about this.`);
      expect(rule.cat, rule.id).toBe('attested');
      expect(rule.clause, rule.id).toMatch(/^This rule reports that .+ cannot be observed from the site\u2019s public pages/);
    });
  });

  it('says what was not checked, per memo §9 and §6.4, with the multi-turn line as the report carries it', () => {
    expect(adult.not_checked.map((item) => item.subject)).toEqual([
      'Messages to the product\u2019s characters',
      'Presence away from the site',
      'Behaviour over a long conversation',
    ]);
    // Held equal to the engine's ADULT_MULTI_TURN_BOUNDARY in packages/engine/test/adultAttestations.test.ts.
  });

  it('names, for every rule that quotes a source, which source it quotes (cluster 4b)', () => {
    const citations = citationsByRule(corpusText);
    for (const rule of adult.rules) {
      // A rule Mintro wrote quotes nothing, so no provenance entry names it.
      const cited = citations[rule.id];
      if (rule.source === 'programme') expect(typeof cited, rule.id).toBe('string');
      else expect(cited, rule.id).toBeUndefined();
    }
    expect(new Set(Object.values(citations))).toEqual(
      new Set(['Mastercard Rules 5.12.7', 'TAKE IT DOWN Act § 3(a)', 'Cal. SB 243, Bus. & Prof. Code § 22602(a)']),
    );
  });

  it('declares which way each cited source runs, and nothing for its own rules (D-290)', () => {
    const directions = Object.fromEntries(adult.rules.map((rule) => [rule.id, rule.direction]));

    expect(directions).toMatchObject({
      // Sources that oblige the merchant to have something.
      'AIGATE-003': 'requires',
      'AIPOL-001': 'requires',
      'AIPOL-002': 'requires',
      'AIPOL-003': 'requires',
      'AIPOL-004': 'requires',
      'AIPOL-006': 'requires',
      'AITD-001': 'requires',
      'AITD-002': 'requires',
      // Sources that forbid something.
      'AIFEAT-002': 'prohibits',
      'AICAT-001': 'prohibits',
      'AICAT-002': 'prohibits',
    });

    for (const rule of adult.rules) {
      if (rule.source === 'mintro') expect(rule.direction, rule.id).toBeUndefined();
      else expect(rule.direction, rule.id).toBeDefined();
    }
  });

  it('agrees, rule by rule, with the sense the label is read from', () => {
    for (const rule of adult.rules) {
      if (rule.direction === undefined) continue;
      expect(rule.sense, rule.id).toBe(rule.direction === 'requires' ? 'present' : 'absent');
    }
  });

  it('is the rule set the adult_ai vertical loads', () => {
    expect(loadRulesetForVertical('adult_ai', REPO_ROOT)).toEqual(adult);
  });
});

describe('the adult corpus check fails the ways it exists to', () => {
  it('refuses a clause changed by one character', () => {
    const altered = {
      ...adult,
      rules: adult.rules.map((rule) =>
        rule.id === 'AITD-002' ? { ...rule, clause: rule.clause.replace('48 hours', '49 hours') } : rule,
      ),
    };
    const defects = checkAgainstCorpus(altered, corpusText, ADULT_CORPUS_PATH);
    expect(defects.some((d) => d.ruleId === 'AITD-002' && /not a byte-exact substring/.test(d.message))).toBe(true);
  });

  it('refuses an empty corpus rather than matching every clause against it', () => {
    const defects = checkAgainstCorpus(adult, '', ADULT_CORPUS_PATH);
    expect(defects).toHaveLength(1);
    expect(defects[0]!.message).toMatch(/the standards corpus is empty/);
  });
});

describe('the peptide vertical is unchanged', () => {
  it('still asks its twenty questions, each with its authority and severity', () => {
    const peptides = loadRulesetFile(RULESET_PATH);
    expect(peptides.attestations).toHaveLength(20);
    for (const q of peptides.attestations) {
      expect(q.authority, q.id).toBeDefined();
      expect(q.sev, q.id).toBeDefined();
    }
  });

  it('still resolves rules/ruleset.json and the RUO corpus, at version 3.11.0', () => {
    expect(VERTICAL_FILES.peptides.ruleset).toBe('rules/ruleset.json');
    expect(VERTICAL_FILES.peptides.corpus).toBe('rules/sources/ruo-standards-v1.1.md');
    expect(VERTICAL_FILES.peptides.ratifiedTiers).toBe(true);
    const peptides = loadRulesetForVertical('peptides', REPO_ROOT);
    expect(peptides.version).toBe('3.11.0');
    expect(peptides).toEqual(loadRulesetFile(RULESET_PATH));
  });

  it('carries no citation lines, so its report renders as it always has', () => {
    expect(citationsByRule(readFileSync(resolve(REPO_ROOT, VERTICAL_FILES.peptides.corpus), 'utf8'))).toEqual({});
  });

  it('reads a peptide rule with no sense as absent', () => {
    const peptides = loadRulesetFile(RULESET_PATH);
    // No peptide rule declares one; the field is optional and its absence is `absent`.
    expect(peptides.rules.filter((rule) => rule.sense !== undefined)).toEqual([]);
    const gate = peptides.rules.find((rule) => rule.id === 'GATE-002')!;
    expect(gate.sense).toBeUndefined();
    expect(senseOf(gate)).toBe('absent');
  });
});
