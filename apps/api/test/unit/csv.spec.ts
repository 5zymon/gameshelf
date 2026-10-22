import { csvCell, toCsv } from '../../src/export/csv';

describe('csvCell', () => {
  it('leaves a plain value unquoted', () => {
    expect(csvCell('Zelda')).toBe('Zelda');
  });

  it('quotes a value with a comma', () => {
    expect(csvCell('Mario, Luigi')).toBe('"Mario, Luigi"');
  });

  it('quotes a value with a quote and doubles the inner quotes', () => {
    expect(csvCell('The "Best" Game')).toBe('"The ""Best"" Game"');
  });

  it('quotes a value with a line feed', () => {
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('quotes a value with a CRLF', () => {
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"');
  });

  it('renders null as empty', () => {
    expect(csvCell(null)).toBe('');
  });

  it('renders numbers without quoting', () => {
    expect(csvCell(1998)).toBe('1998');
    expect(csvCell(0)).toBe('0');
  });
});

describe('toCsv', () => {
  it('returns exactly the header line when there are no rows', () => {
    expect(toCsv(['A', 'B'], [])).toBe('A,B\r\n');
  });

  it('joins cells with commas and lines with CRLF, with a trailing CRLF', () => {
    expect(
      toCsv(
        ['A', 'B', 'C'],
        [
          ['x', 1, null],
          ['y,z', 2, 'q'],
        ],
      ),
    ).toBe('A,B,C\r\nx,1,\r\n"y,z",2,q\r\n');
  });
});
