import { parseSitePlan, type SitePlanResult, type SitePlanTextItem } from '@acad/engine';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * Reads a site plan PDF locally in the browser (the file is never uploaded)
 * and extracts the project details from its text layer.
 */
export async function readSitePlan(file: File): Promise<SitePlanResult> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  try {
    const page = await doc.getPage(1);
    const { height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: SitePlanTextItem[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: height - it.transform[5], w: it.width });
    }
    if (!items.length) throw new Error('This PDF has no readable text (it may be a scan). Please fill in the fields manually.');
    return parseSitePlan(items);
  } finally {
    void doc.destroy();
  }
}
