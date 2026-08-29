/**
 * Reading flags and positionals off `process.argv` without confusing one for the other.
 *
 * `argv.find((arg) => !arg.startsWith('--'))` was the idiom here, and it is wrong whenever a flag
 * takes a value: in `--report-dir fixtures/reports c268f8d7` the first non-flag token is
 * `fixtures/reports`, so the directory gets read as the run selector and the run id is ignored.
 * It was latent while the only value-taking flags were `--send` and `--out`, which are usually
 * typed after the positional; `--report-dir` made it fire.
 *
 * A parser has to know which flags consume the token after them. There is no way to infer it.
 */

/** The value after `--name`, or `fallback` when the flag is absent or ends the arguments. */
export function flagValue(argv: readonly string[], name: string, fallback: string): string {
  const at = argv.indexOf(name);
  if (at === -1) return fallback;
  return argv[at + 1] ?? fallback;
}

/**
 * Arguments that are neither a flag nor a flag's value.
 *
 * `valueFlags` names every flag that consumes the token after it, so those tokens are skipped
 * rather than mistaken for positionals.
 */
export function positionals(argv: readonly string[], valueFlags: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (valueFlags.includes(arg)) {
      i += 1; // its value, whatever it looks like
      continue;
    }
    if (arg.startsWith('--')) continue;
    out.push(arg);
  }
  return out;
}
