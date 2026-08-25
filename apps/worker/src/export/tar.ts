/**
 * A deterministic POSIX ustar writer and reader.
 *
 * ## Why this rather than a library
 *
 * Two reasons, and the second is the real one.
 *
 * **The archive has to be byte-deterministic.** The same package exported twice must produce the
 * same bytes, or the manifest hash is a fact about when the export ran rather than about what it
 * contains — and D-106 already rules that a fixture whose bytes change per run cannot test anything
 * content-addressed. Every zip writer stamps mtimes; making one deterministic means fighting it.
 * Here mtime, uid, gid and mode are fixed constants because nothing about them is a fact worth
 * carrying.
 *
 * **Nothing else in this project reads the archive.** It is written once, moved to a vault by hand,
 * and opened years later by whoever is asking. `tar` is the format most likely to still open
 * without ceremony, and it is 512-byte headers and octal fields — small enough to write correctly
 * and small enough for a reviewer to check that it was.
 *
 * Uncompressed on purpose. The contents are already-compressed PDFs and JPEGs, so compression buys
 * little, and gzip carries an mtime in its own header, which is the determinism problem again one
 * layer out.
 */

const BLOCK = 512;

/** Fixed for every entry. None of these is a fact about the export worth preserving. */
const MODE = '000644 ';
const ZERO_NUMERIC = '000000 ';
const MTIME = '00000000000 ';

export interface TarEntry {
  /** Path inside the archive. ASCII, at most 100 bytes — see `writeTar`. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export class TarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TarError';
  }
}

const enc = new TextEncoder();

function writeAscii(into: Uint8Array, at: number, value: string, width: number): void {
  const bytes = enc.encode(value);
  if (bytes.length > width) {
    throw new TarError(`"${value}" does not fit in ${width} bytes`);
  }
  into.set(bytes, at);
}

/** Octal, right-aligned, zero-padded, with the trailing space ustar readers expect. */
function octal(value: number, width: number): string {
  const digits = width - 1;
  const text = value.toString(8);
  if (text.length > digits) {
    throw new TarError(`${value} does not fit in ${digits} octal digits`);
  }
  return `${text.padStart(digits, '0')} `;
}

function header(path: string, size: number): Uint8Array {
  const head = new Uint8Array(BLOCK);

  /*
    Refused rather than split across `prefix`.

    A long path is representable in ustar, and the code to do it is code nobody here would exercise:
    every path this writer emits is a fixed prefix plus a uuid. Refusing keeps the writer honest —
    a path that does not fit is a bug in whoever built the entry list, and truncating it silently
    would put a body in the archive under a name that no longer identifies it.
  */
  if (enc.encode(path).length > 100) {
    throw new TarError(`archive path is longer than ustar's 100 bytes: ${path}`);
  }

  writeAscii(head, 0, path, 100);
  writeAscii(head, 100, MODE, 8);
  writeAscii(head, 108, ZERO_NUMERIC, 8); // uid
  writeAscii(head, 116, ZERO_NUMERIC, 8); // gid
  writeAscii(head, 124, octal(size, 12), 12);
  writeAscii(head, 136, MTIME, 12);
  writeAscii(head, 148, '        ', 8); // checksum, as spaces while it is computed
  writeAscii(head, 156, '0', 1); // typeflag: a regular file
  writeAscii(head, 257, 'ustar', 6);
  writeAscii(head, 263, '00', 2);

  let sum = 0;
  for (const byte of head) sum += byte;
  // Six octal digits, NUL, space — the form every reader accepts.
  writeAscii(head, 148, `${sum.toString(8).padStart(6, '0')}\0 `, 8);

  return head;
}

const padding = (size: number): number => (BLOCK - (size % BLOCK)) % BLOCK;

/**
 * One archive from a list of entries, in the order given.
 *
 * Order is the caller's and is preserved, because `manifest.json` goes first: a reader opening this
 * in ten years should reach the description before the bodies.
 */
export function writeTar(entries: readonly TarEntry[]): Uint8Array {
  const seen = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    if (seen.has(entry.path)) {
      // Two entries at one path is one entry silently lost on extraction, and the manifest would
      // list both.
      throw new TarError(`duplicate archive path: ${entry.path}`);
    }
    seen.add(entry.path);
    total += BLOCK + entry.bytes.length + padding(entry.bytes.length);
  }
  total += BLOCK * 2; // the two zero blocks that end an archive

  const out = new Uint8Array(total);
  let at = 0;
  for (const entry of entries) {
    out.set(header(entry.path, entry.bytes.length), at);
    at += BLOCK;
    out.set(entry.bytes, at);
    at += entry.bytes.length + padding(entry.bytes.length);
  }
  return out;
}

/**
 * Read one back.
 *
 * Deliberately a separate implementation from the writer rather than the writer run backwards. The
 * reconciler uses this to check what is *in* the archive, and a reader that shares the writer's
 * assumptions would agree with it about a malformed archive — which is the same self-agreement
 * D-130 refuses in the manifest.
 */
export function readTar(archive: Uint8Array): TarEntry[] {
  const dec = new TextDecoder();
  const entries: TarEntry[] = [];
  let at = 0;
  let ended = false;

  while (at + BLOCK <= archive.length) {
    const head = archive.subarray(at, at + BLOCK);
    if (head.every((b) => b === 0)) {
      ended = true; // the end-of-archive blocks
      break;
    }

    const magic = dec.decode(head.subarray(257, 262));
    if (magic !== 'ustar') {
      throw new TarError(`not a ustar header at byte ${at}`);
    }

    const path = dec.decode(head.subarray(0, 100)).replace(/\0.*$/, '');
    const sizeText = dec.decode(head.subarray(124, 136)).replace(/[\0 ]/g, '');
    const size = Number.parseInt(sizeText, 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new TarError(`unreadable size for ${path}`);
    }

    const start = at + BLOCK;
    if (start + size > archive.length) {
      // The truncation case, named. An archive that ends mid-entry is exactly what read-back
      // verification exists to catch, and it must not come back as a short entry.
      throw new TarError(`archive is truncated: ${path} claims ${size} bytes and the file ends first`);
    }
    entries.push({ path, bytes: archive.slice(start, start + size) });
    at = start + size + padding(size);
  }

  /*
    The terminator, and why it is load-bearing rather than pedantry.

    Without this a truncated archive reads as a *shorter valid one*: the loop consumes whole entries
    until there is not a full header left, then exits quietly with everything it managed to parse.
    A download that died at 80% would come back as a clean list of files, and read-back verification
    would compare that list against the database and report only the members that happen to be
    missing — describing a broken file as an incomplete export.

    A well-formed archive ends in zero blocks. Reaching the end of the bytes without them means the
    bytes are not all there. Found by a test that truncated an archive and got no error.
  */
  if (!ended) {
    throw new TarError(
      'archive is truncated: it ends without the end-of-archive marker, so an unknown number of ' +
        'entries are missing rather than a known number',
    );
  }

  return entries;
}
