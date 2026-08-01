/**
 * Minimal EPUB CFI parse/compare (foliate-js epubcfi.js, MIT).
 * Used only for focus-chunk selection against extract frontmatter CFIs.
 */

/** Reject pathological client CFIs before tokenizer (algo-complexity DoS). */
export const CFI_COMPARE_MAX_LENGTH = 4096;

const isNumber = /\d/;
const isCFI = /^epubcfi\((.*)\)$/;

const findIndices = (arr, f) =>
  arr.map((x, i, a) => (f(x, i, a) ? i : null)).filter((x) => x != null);

const splitAt = (arr, is) =>
  [-1, ...is, arr.length].reduce(
    ({ xs, a }, b) => ({ xs: xs?.concat([arr.slice(a + 1, b)]) ?? [], a: b }),
    {},
  ).xs;

const concatArrays = (a, b) =>
  a.slice(0, -1).concat([a[a.length - 1].concat(b[0])]).concat(b.slice(1));

const unwrap = (x) => x.match(isCFI)?.[1] ?? x;

const tokenizer = (str) => {
  const tokens = [];
  let state;
  let escape;
  let value = '';
  const push = (x) => {
    tokens.push(x);
    state = null;
    value = '';
  };
  const cat = (x) => {
    value += x;
    escape = false;
  };
  for (const char of Array.from(str.trim()).concat('')) {
    if (char === '^' && !escape) {
      escape = true;
      continue;
    }
    if (state === '!') push(['!']);
    else if (state === ',') push([',']);
    else if (state === '/' || state === ':') {
      if (isNumber.test(char)) {
        cat(char);
        continue;
      } else push([state, parseInt(value, 10)]);
    } else if (state === '~') {
      if (isNumber.test(char) || char === '.') {
        cat(char);
        continue;
      } else push(['~', parseFloat(value)]);
    } else if (state === '@') {
      if (char === ':') {
        push(['@', parseFloat(value)]);
        state = '@';
        continue;
      }
      if (isNumber.test(char) || char === '.') {
        cat(char);
        continue;
      } else push(['@', parseFloat(value)]);
    } else if (state === '[') {
      if (char === ';' && !escape) {
        push(['[', value]);
        state = ';';
      } else if (char === ',' && !escape) {
        push(['[', value]);
        state = '[';
      } else if (char === ']' && !escape) push(['[', value]);
      else cat(char);
      continue;
    } else if (state?.startsWith(';')) {
      if (char === '=' && !escape) {
        state = `;${value}`;
        value = '';
      } else if (char === ';' && !escape) {
        push([state, value]);
        state = ';';
      } else if (char === ']' && !escape) push([state, value]);
      else cat(char);
      continue;
    }
    if (
      char === '/' ||
      char === ':' ||
      char === '~' ||
      char === '@' ||
      char === '[' ||
      char === '!' ||
      char === ','
    ) {
      state = char;
    }
  }
  return tokens;
};

const findTokens = (tokens, x) => findIndices(tokens, ([t]) => t === x);

const parser = (tokens) => {
  const parts = [];
  let state;
  for (const [type, val] of tokens) {
    if (type === '/') parts.push({ index: val });
    else {
      const last = parts[parts.length - 1];
      if (type === ':') last.offset = val;
      else if (type === '~') last.temporal = val;
      else if (type === '@') last.spatial = (last.spatial ?? []).concat(val);
      else if (type === ';s') last.side = val;
      else if (type === '[') {
        if (state === '/' && val) last.id = val;
        else {
          last.text = (last.text ?? []).concat(val);
          continue;
        }
      }
    }
    state = type;
  }
  return parts;
};

const parserIndir = (tokens) => splitAt(tokens, findTokens(tokens, '!')).map(parser);

export function parse(cfi) {
  if (typeof cfi !== 'string' || cfi.length > CFI_COMPARE_MAX_LENGTH) {
    throw new Error('cfi_too_long');
  }
  const tokens = tokenizer(unwrap(cfi));
  const commas = findTokens(tokens, ',');
  if (!commas.length) return parserIndir(tokens);
  const [parent, start, end] = splitAt(tokens, commas).map(parserIndir);
  return { parent, start, end };
}

const escapeCFI = (str) => str.replace(/[\^[\](),;=]/g, '^$&');

const partToString = ({ index, id, offset, temporal, spatial, text, side }) => {
  const param = side ? `;s=${side}` : '';
  return (
    `/${index}` +
    (id ? `[${escapeCFI(id)}${param}]` : '') +
    (offset != null && index % 2 ? `:${offset}` : '') +
    (temporal ? `~${temporal}` : '') +
    (spatial ? `@${spatial.join(':')}` : '') +
    (text || (!id && side)
      ? `[${text?.map(escapeCFI)?.join(',') ?? ''}${param}]`
      : '')
  );
};

const toInnerString = (parsed) =>
  parsed.parent
    ? [parsed.parent, parsed.start, parsed.end].map(toInnerString).join(',')
    : parsed.map((parts) => parts.map(partToString).join('')).join('!');

const wrap = (x) => (isCFI.test(x) ? x : `epubcfi(${x})`);
const toString = (parsed) => wrap(toInnerString(parsed));

export function collapse(x, toEnd) {
  return typeof x === 'string'
    ? toString(collapse(parse(x), toEnd))
    : x.parent
      ? concatArrays(x.parent, x[toEnd ? 'end' : 'start'])
      : x;
}

/**
 * @param {string | object} a
 * @param {string | object} b
 * @returns {number}
 */
export function compare(a, b) {
  if (typeof a === 'string') a = parse(a);
  if (typeof b === 'string') b = parse(b);
  if (a.start || b.start) {
    return compare(collapse(a), collapse(b)) || compare(collapse(a, true), collapse(b, true));
  }

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const p = a[i] ?? [];
    const q = b[i] ?? [];
    const maxIndex = Math.max(p.length, q.length) - 1;
    for (let j = 0; j <= maxIndex; j++) {
      const x = p[j];
      const y = q[j];
      if (!x) return -1;
      if (!y) return 1;
      if (x.index > y.index) return 1;
      if (x.index < y.index) return -1;
      if (j === maxIndex) {
        if (x.offset > y.offset) return 1;
        if (x.offset < y.offset) return -1;
      }
    }
  }
  return 0;
}

/**
 * True when `cfi` lies in [startCfi, endCfi] (inclusive), or compare fails.
 * @param {string} cfi
 * @param {string} startCfi
 * @param {string} endCfi
 */
export function cfiInRange(cfi, startCfi, endCfi) {
  if (
    typeof cfi !== 'string' ||
    typeof startCfi !== 'string' ||
    typeof endCfi !== 'string' ||
    cfi.length > CFI_COMPARE_MAX_LENGTH ||
    startCfi.length > CFI_COMPARE_MAX_LENGTH ||
    endCfi.length > CFI_COMPARE_MAX_LENGTH
  ) {
    return false;
  }
  try {
    return compare(cfi, startCfi) >= 0 && compare(cfi, endCfi) <= 0;
  } catch {
    return false;
  }
}
