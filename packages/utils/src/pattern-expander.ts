/**
 * Pattern Expander for Batch URLs
 *
 * Supports patterns such as:
 * - Numeric ranges with zero-padding: [01-10] -> 01, 02, ..., 10
 * - Numeric ranges without padding: [1-10] -> 1, 2, ..., 10
 * - Numeric ranges with custom step: [1-20:2] -> 1, 3, 5, ..., 19
 * - Lowercase alphabetic ranges: [a-e] -> a, b, c, d, e
 * - Uppercase alphabetic ranges: [A-E] -> A, B, C, D, E
 * - Multiple patterns in a single URL (cartesian product)
 * - Safe limits: caps max expansion per URL at 500 items to prevent resource exhaustion
 */

const MAX_ITEMS_PER_URL = 500;
const PATTERN_REGEX = /\[(?:(\d+)-(\d+)(?::(\d+))?|([a-zA-Z])-([a-zA-Z]))\]/;

export function hasUrlPattern(text: string): boolean {
  return /\[(?:\d+-\d+(?::\d+)?|[a-zA-Z]-[a-zA-Z])\]/.test(text);
}

/**
 * Expands a single URL or line containing bracket patterns.
 */
export function expandSinglePattern(template: string): string[] {
  let results = [template];

  let match: RegExpExecArray | null;
  // Expand bracket matches iteratively from left to right
  while ((match = PATTERN_REGEX.exec(results[0])) !== null) {
    const fullMatch = match[0];
    const isNumeric = match[1] !== undefined;

    const replacements: string[] = [];

    if (isNumeric) {
      const rawStart = match[1];
      const rawEnd = match[2];
      const step = match[3] ? Math.max(1, parseInt(match[3], 10)) : 1;

      const padWidth = rawStart.length > 1 && rawStart.startsWith('0') ? rawStart.length : 0;
      const start = parseInt(rawStart, 10);
      const end = parseInt(rawEnd, 10);

      if (start <= end) {
        for (let i = start; i <= end; i += step) {
          replacements.push(padWidth > 0 ? String(i).padStart(padWidth, '0') : String(i));
          if (replacements.length >= MAX_ITEMS_PER_URL) break;
        }
      } else {
        for (let i = start; i >= end; i -= step) {
          replacements.push(padWidth > 0 ? String(i).padStart(padWidth, '0') : String(i));
          if (replacements.length >= MAX_ITEMS_PER_URL) break;
        }
      }
    } else {
      const startChar = match[4].charCodeAt(0);
      const endChar = match[5].charCodeAt(0);

      if (startChar <= endChar) {
        for (let c = startChar; c <= endChar; c++) {
          replacements.push(String.fromCharCode(c));
          if (replacements.length >= MAX_ITEMS_PER_URL) break;
        }
      } else {
        for (let c = startChar; c >= endChar; c--) {
          replacements.push(String.fromCharCode(c));
          if (replacements.length >= MAX_ITEMS_PER_URL) break;
        }
      }
    }

    if (replacements.length === 0) {
      break;
    }

    const nextBatch: string[] = [];
    for (const item of results) {
      for (const rep of replacements) {
        nextBatch.push(item.replace(fullMatch, rep));
        if (nextBatch.length >= MAX_ITEMS_PER_URL) break;
      }
      if (nextBatch.length >= MAX_ITEMS_PER_URL) break;
    }

    results = nextBatch;
  }

  return results;
}

/**
 * Expands all pattern occurrences across multiple lines of text.
 */
export function expandUrlPatterns(input: string): string[] {
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const output: string[] = [];
  for (const line of lines) {
    if (hasUrlPattern(line)) {
      output.push(...expandSinglePattern(line));
    } else {
      output.push(line);
    }
  }

  return output;
}
