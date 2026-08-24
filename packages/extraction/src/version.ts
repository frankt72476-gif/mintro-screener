/**
 * Half of the cache key (D-096).
 *
 * **Bump this on any change to prompts, response schemas, the field vocabulary, routing, or the
 * shape of a provenance record.** The hash alone says the bytes are the same; it says nothing
 * about whether the thing that read them still exists. A cache keyed on content alone serves
 * results from an extractor that is no longer in the tree, and nothing about the served result
 * says so.
 *
 * Format is `major.minor` and it is compared as an opaque string, never ordered.
 */
export const EXTRACTOR_VERSION = '0.1.0';
