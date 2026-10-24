/* The typed surface of `pdf-reader.js`.
 *
 * Only `read` is declared, because only `read` is called from the app — the
 * other exports exist for the reader's own tests. Declaring the whole module
 * would invite callers to reach into internals that were ported, not designed
 * for this codebase.
 *
 * A result is a discriminated union rather than a bag of optional fields, so a
 * caller cannot read `.text` off a file that could not be read. Distinguishing
 * "no text in it" from "could not be read" is the whole point: a scan and a
 * corrupt file need different things said to the user.
 */

export type PdfResult =
  | {
      readable: true;
      /** Pages the document has. */
      pages: number;
      /** Pages that yielded text, which is fewer when some are images. */
      pagesRead: number;
      /** True when a page limit stopped the read before the end. */
      truncated: boolean;
      text: string;
      byPage: { page: number; text: string }[];
    }
  | {
      readable: false;
      pages?: number;
      /** Why, in words fit to show a user. Encryption and scans read differently. */
      reason: string;
    };

export function read(buffer: Buffer, options?: { maxPages?: number }): PdfResult;
