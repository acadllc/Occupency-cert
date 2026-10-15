import { parseDocument, type DocumentImport, type SitePlanTextItem } from '@acad/engine';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

const MAX_PAGES = 20;

/**
 * Reads an uploaded PDF locally in the browser (the file is never uploaded)
 * and extracts project details from its text: site plan, Emirates ID,
 * passport, كفالة papers or any form with labelled fields.
 */
export async function readDocument(file: File): Promise<DocumentImport> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  try {
    const pages: SitePlanTextItem[][] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const { height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: SitePlanTextItem[] = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        items.push({ str: it.str, x: it.transform[4], y: height - it.transform[5], w: it.width });
      }
      pages.push(items);
    }
    const result = parseDocument(pages);
    if (doc.numPages > MAX_PAGES) result.notes.push(`Only the first ${MAX_PAGES} of ${doc.numPages} pages were read.`);
    return result;
  } finally {
    void doc.destroy();
  }
}
