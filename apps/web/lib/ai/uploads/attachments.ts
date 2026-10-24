/* Files handed to the assistant with a question.
 *
 * WHAT HAPPENS TO EACH KIND, AND WHY THEY DIFFER:
 *
 *   A DOCUMENT IS READ HERE AND ONLY ITS TEXT TRAVELS. A twenty-page report
 *   cannot be sent to a model and does not need to be — its words can. Reading
 *   it here also means the size limit is about what a person can upload rather
 *   than about what a prompt can hold.
 *
 *   AN IMAGE IS NOT READ HERE. There is no character recognition in this
 *   application and inventing a description would be worse than useless: the
 *   answer would be confidently about something nobody looked at. What the
 *   assistant gets is the fact that an image was attached and its filename, and
 *   it is told to say it cannot see it. That is an honest limitation, stated
 *   plainly, rather than a silent one.
 *
 * NOTHING IS WRITTEN TO DISK. The Hub stores no transcript, and an attachment is
 * part of a turn: it is decoded, read, used, and dropped when the request ends.
 * Team Chat has real file storage for files that are meant to persist — this is
 * not that, and conflating the two would put client documents in a bucket
 * because somebody asked a question about one.
 */

import { read as readPdf } from './pdf-reader';

/* Comfortably larger than any report somebody would ask about, small enough
   that a mistaken drag of a video is refused rather than uploaded. */
export const MAX_BYTES = 12 * 1024 * 1024;
export const MAX_FILES = 4;

/* What a prompt can absorb from one file without crowding out everything else
   in it. A long report is truncated with the truncation stated, never silently:
   an answer drawn from the first third of a document, presented as an answer
   about the document, is the failure this limit creates if it is hidden. */
const MAX_TEXT_CHARS = 24_000;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json'
]);

export interface IncomingFile {
  name: string;
  mime: string;
  /** The file's bytes, base64 encoded — how it crossed the request boundary. */
  data: string;
}

export interface ReadAttachment {
  name: string;
  kind: 'pdf' | 'image' | 'text';
  /** The text the model reads. For an image, the line that accompanies the picture. */
  text: string;
  /** Set on images: the bytes, sent to the model as a picture rather than described. */
  media?: { mime: string; data: string; name: string };
  /** Set when something is worth telling the user about the file itself. */
  note?: string;
}

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentError';
  }
}

/** A name safe to put in a prompt. Never used to open, write or serve anything. */
function displayName(name: string): string {
  return String(name || 'untitled')
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, 120);
}

/**
 * Decode and read one file.
 *
 * Throws only for a file that should not have been accepted at all. A file that
 * is the right kind but cannot be read comes back as an attachment whose text
 * says so — because "this PDF is a scan" is something the answer should mention,
 * not something that should fail the question.
 */
export function readAttachment(file: IncomingFile): ReadAttachment {
  const name = displayName(file.name);
  const mime = String(file.mime || '').toLowerCase().split(';')[0]!.trim();

  let bytes: Buffer;
  try {
    bytes = Buffer.from(String(file.data || ''), 'base64');
  } catch {
    throw new AttachmentError(`${name} could not be decoded.`);
  }

  if (!bytes.length) throw new AttachmentError(`${name} is empty.`);
  if (bytes.length > MAX_BYTES) {
    throw new AttachmentError(
      `${name} is ${Math.round(bytes.length / 1048576)}MB, and the limit is ${Math.round(MAX_BYTES / 1048576)}MB.`
    );
  }

  if (IMAGE_TYPES.has(mime)) {
    /* THE IMAGE IS SENT AS AN IMAGE.
     *
     * An earlier version of this returned "you cannot see it", which made every
     * screenshot useless — and a screenshot is how most things actually arrive
     * here: a photographed letter, a page of a scanned application, a table out
     * of a report. The bytes now travel to the model as a picture rather than
     * being turned into a sentence on the way in, because describing a document
     * in words at the door throws away the thing being asked about.
     *
     * The text below accompanies the picture; it does not stand in for it. */
    return {
      name,
      kind: 'image',
      text: `An image named "${name}" is attached. Look at it and answer from what it actually shows. If it is a document, read the text in it.`,
      media: { mime, data: bytes.toString('base64'), name }
    };
  }

  const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(name);

  if (isPdf) {
    const result = readPdf(bytes, { maxPages: 60 });

    if (!result.readable) {
      /* A SCAN IS NOT A DEAD END ANY MORE, so the message says what to do next.
       *
       * There is no character recognition here and adding one is a dependency
       * this project will not take. But images now go to the model as pictures,
       * which means a screenshot of the same page IS readable — so the useful
       * thing to tell somebody holding a scanned PDF is that, rather than only
       * that their file failed. */
      const scanned = /scan/i.test(result.reason);

      return {
        name,
        kind: 'pdf',
        text: [
          `The PDF "${name}" could not be read: ${result.reason}`,
          scanned
            ? 'Tell them this PDF has no text layer, and that screenshotting the pages and attaching those images instead will work, because you can read images.'
            : ''
        ]
          .filter(Boolean)
          .join(' '),
        note: scanned ? 'No text in this PDF — screenshot the pages and attach those instead.' : result.reason
      };
    }

    const truncated = result.text.length > MAX_TEXT_CHARS;
    const note = truncated
      ? `Only the first ${MAX_TEXT_CHARS.toLocaleString('en-GB')} characters were read.`
      : result.truncated
        ? `Read the first ${result.pagesRead} of ${result.pages} pages.`
        : undefined;

    return {
      name,
      kind: 'pdf',
      text: [
        `${result.pages} page(s), ${result.pagesRead} of which contained text.`,
        note ?? '',
        '',
        result.text.slice(0, MAX_TEXT_CHARS)
      ]
        .filter(Boolean)
        .join('\n'),
      note
    };
  }

  if (TEXT_TYPES.has(mime) || /\.(txt|md|csv|tsv|json|log)$/i.test(name)) {
    const text = bytes.toString('utf8');
    const truncated = text.length > MAX_TEXT_CHARS;

    return {
      name,
      kind: 'text',
      text: text.slice(0, MAX_TEXT_CHARS),
      note: truncated ? `Only the first ${MAX_TEXT_CHARS.toLocaleString('en-GB')} characters were read.` : undefined
    };
  }

  throw new AttachmentError(
    `${name} is not a kind of file that can be read here. PDFs, images, CSVs and plain text are understood.`
  );
}

/** Read a set of files, refusing the whole set rather than silently dropping one. */
export function readAttachments(files: IncomingFile[]): ReadAttachment[] {
  if (files.length > MAX_FILES) {
    throw new AttachmentError(`Attach at most ${MAX_FILES} files to one question.`);
  }
  return files.map(readAttachment);
}
