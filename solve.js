// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Same answers as csv-reader 1.0.0 for every input, but driven by indexOf/slice/split
// instead of a character-at-a-time loop. The reference's policy, kept exactly:
//
//   - U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not doubled, "" inside
//     is one quote, each CRLF or lone CR inside is read as LF; what follows its closing
//     quote up to the next comma or line break is appended as it stands (quote_junk, when
//     the field ends); a quote that never closes is a literal character and the text after
//     it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings;
//   - columns is the first record when header is true, else null; rows holds the rest,
//     each padded (short_row, with fields: its count) or cut (long_row, with extra: the
//     cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met; line is the 1-based line its
//     record starts on (every LF, CRLF and lone CR inside quotes counted), row its
//     record's index in rows (null for the header).
//
// Two paths: a record with no quote before its line break and no stray CR is split in
// one go; anything else goes through the field scanner below, which mirrors the
// reference field by field.

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;
  // Every CR offset, once: the next CR is then a pointer walk, not an indexOf
  // scan that can run to the end of the text when CRs are sparse.
  const crs = [];
  {
    let p = text.indexOf('\r');
    while (p !== -1) {
      crs.push(p);
      p = text.indexOf('\r', p + 1);
    }
  }
  let crPtr = 0;
  // Same for quotes: the next quote is then a pointer walk, not a scan that
  // can run to the end of the text (the unterminated-quote tail holds none).
  const qts = [];
  {
    let p = text.indexOf('"');
    while (p !== -1) {
      qts.push(p);
      p = text.indexOf('"', p + 1);
    }
  }
  let qPtr = 0;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    let fields = null;
    let ended = BREAK;

    // Fast path: this record holds no quote before its line break and no stray CR,
    // so it is one slice split on commas.
    const ln = text.indexOf('\n', pos);
    while (qPtr < qts.length && qts[qPtr] < pos) qPtr++;
    const q0 = qPtr < qts.length ? qts[qPtr] : -1;
    if (q0 === -1 || (ln !== -1 && q0 > ln)) {
      let segEnd = ln === -1 ? n : ln;
      // A CR just before the LF is the CRLF ending; a CR with no LF after it is
      // a stray CR, not a line ending, so it must not be stripped here.
      if (ln !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd--;
      while (crPtr < crs.length && crs[crPtr] < pos) crPtr++;
      const ri = crPtr < crs.length ? crs[crPtr] : -1;
      if (ri === -1 || ri >= segEnd) {
        fields = text.slice(pos, segEnd).split(',');
        if (ln === -1) {
          pos = n;
          ended = END;
        } else {
          pos = ln + 1;
          line++;
          ended = BREAK;
        }
      }
    }

    if (fields === null) {
      // Slow path: field by field, mirroring the reference.
      fields = [];
      let lastQuoted = false;
      do {
        let value = '';
        let scan = true;
        let junkCheck = false;
        let added = 0;
        if (text.charCodeAt(pos) === 34) {
          // Quoted field.
          lastQuoted = true;
          const open = pos;
          let seg = pos + 1;
          let parts = null;
          let close = -1;
          let q = text.indexOf('"', seg);
          while (q !== -1) {
            if (text.charCodeAt(q + 1) === 34) {
              if (parts === null) parts = [];
              parts.push(text.slice(seg, q));
              seg = q + 2;
              q = text.indexOf('"', seg);
            } else {
              close = q;
              break;
            }
          }
          if (close === -1) {
            // The quote never closes: it is a literal character, and the text after
            // it is read again as unquoted.
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            pos = open + 1;
            value = '"';
          } else {
            let content;
            if (parts === null) {
              content = text.slice(pos + 1, close);
            } else {
              parts.push(text.slice(seg, close));
              content = parts.join('"');
            }
            pos = close + 1;
            if (content.indexOf('\r') !== -1 || content.indexOf('\n') !== -1) {
              const breaks = content.match(/\r\n|\r|\n/g);
              if (breaks !== null) line += breaks.length;
              content = content.replace(/\r\n|\r/g, '\n');
            }
            value = content;
            if (pos >= n) {
              ended = END;
              scan = false;
            } else {
              const c = text.charCodeAt(pos);
              if (c === 44) {
                pos++;
                ended = COMMA;
                scan = false;
              } else if (c === 10) {
                pos++;
                line++;
                ended = BREAK;
                scan = false;
              } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
                pos += 2;
                line++;
                ended = BREAK;
                scan = false;
              } else {
                // What follows the closing quote is appended as it stands.
                junkCheck = true;
              }
            }
          }
        } else {
          lastQuoted = false;
        }
        if (scan) {
          // Unquoted scan: appends to value up to the next comma or line break; a
          // CR not followed by LF is dropped (stray_cr) and the field goes on.
          let segStart = pos;
          while (true) {
            const ci = text.indexOf(',', pos);
            const ni = text.indexOf('\n', pos);
            while (crPtr < crs.length && crs[crPtr] < pos) crPtr++;
            const ri = crPtr < crs.length ? crs[crPtr] : -1;
            let m = -1;
            let kind = 0;
            if (ci !== -1) {
              m = ci;
              kind = 0;
            }
            if (ni !== -1 && (m === -1 || ni < m)) {
              m = ni;
              kind = 1;
            }
            if (ri !== -1 && (m === -1 || ri < m)) {
              m = ri;
              kind = 2;
            }
            if (m === -1) {
              value += text.slice(segStart);
              added += n - segStart;
              pos = n;
              ended = END;
              break;
            }
            if (kind === 0) {
              value += text.slice(segStart, m);
              added += m - segStart;
              pos = m + 1;
              ended = COMMA;
              break;
            }
            if (kind === 1) {
              value += text.slice(segStart, m);
              added += m - segStart;
              pos = m + 1;
              line++;
              ended = BREAK;
              break;
            }
            if (text.charCodeAt(m + 1) === 10) {
              value += text.slice(segStart, m);
              added += m - segStart;
              pos = m + 2;
              line++;
              ended = BREAK;
              break;
            }
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            value += text.slice(segStart, m);
            added += m - segStart;
            pos = m + 1;
            segStart = pos;
          }
          if (junkCheck && added > 0) {
            errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          }
        }
        fields.push(value);
      } while (ended === COMMA);

      // A line that held only stray CRs is left with no characters: no record (its
      // stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
