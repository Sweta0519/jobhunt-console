import { PDFDocument } from 'pdf-lib';
import { readFileSync, writeFileSync } from 'node:fs';

export async function pngsToPdf(pngPaths, outPath, { title = '', author = '' } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setAuthor(author); doc.setProducer('linkedin-content'); doc.setCreator('linkedin-content');
  for (const p of pngPaths) {
    const img = await doc.embedPng(readFileSync(p));
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const bytes = await doc.save();
  writeFileSync(outPath, bytes);
  return { pages: pngPaths.length, bytes: bytes.length };
}
