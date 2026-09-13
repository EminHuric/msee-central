/**
 * Getting the data out.
 *
 * WHY A BUSINESS SYSTEM MUST HAVE THIS. An accountant asks for last year's
 * invoices, a bank asks for turnover, somebody wants the figures in a
 * spreadsheet — and any system that cannot answer those has quietly made itself
 * the only place the company's own records exist. That is not a feature gap, it
 * is a risk: software that holds data it will not hand back is software nobody
 * can leave, including when it should be left.
 *
 * WHY CSV AND NOT SOMETHING RICHER. Every spreadsheet, every accountant and every
 * other system in the world reads it. A prettier format that needs this
 * application to open it would be the same lock-in wearing a nicer hat.
 *
 * WHAT IS WRITTEN. Whatever the screen is showing, in the order it is showing it,
 * with the filters that are applied — because the export somebody wants is the
 * list they are looking at, not a different list the export decided to produce.
 */

/**
 * One cell, safe for any spreadsheet.
 *
 * The leading apostrophe cases are not decoration. A value beginning with `=`,
 * `+`, `-` or `@` is treated as a FORMULA by Excel and Sheets, which is how a
 * client called "=cmd" becomes a command somebody's spreadsheet tries to run.
 * Prefixing a quote makes it text, which is what it always was.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ''

  let text = String(value)

  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`

  /* Quotes double, and anything with a separator or newline is quoted. */
  if (/[",\n\r;]/.test(text)) text = `"${text.replace(/"/g, '""')}"`

  return text
}

export interface CsvColumn<T> {
  header: string
  value: (row: T) => unknown
}

/** Build the file's text. Separate from saving it, so it can be tested. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((column) => cell(column.header)).join(',')
  const body = rows.map((row) =>
    columns.map((column) => cell(column.value(row))).join(','),
  )

  /*
   * A byte-order mark, and CRLF between lines.
   *
   * Excel opens a UTF-8 file without one as Windows-1252, which turns every
   * Serbian name into mojibake — and the first thing anybody does with an export
   * is open it in Excel.
   */
  return `﻿${[head, ...body].join('\r\n')}\r\n`
}

/**
 * Hand the file to the browser.
 *
 * The object URL is released on the next tick rather than immediately: revoking
 * it in the same frame as the click cancels the download in some browsers, which
 * looks exactly like a button that does nothing.
 */
export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()

  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** The two steps together, which is how every caller wants them. */
export function exportCsv<T>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[],
): void {
  downloadCsv(`${filename}-${new Date().toISOString().slice(0, 10)}`, toCsv(rows, columns))
}
