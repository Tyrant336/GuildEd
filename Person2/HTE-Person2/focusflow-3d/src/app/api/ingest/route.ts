/**
 * POST /api/ingest — PDF/文字 → 概念擷取 → 知識圖 (Person 2, 2-8h)
 * Body: { "pdfBase64"?: string, "text"?: string } 或 multipart PDF
 */
import { NextRequest, NextResponse } from 'next/server';
import { extractKnowledgeGraphFromText } from '@/lib/ingest';
import { cacheGet, cacheSet, cacheKey } from '@/lib/cache';
import { wantDemoFallback, readDemoCache, DEMO_FILES } from '@/lib/demo-cache';

export const maxDuration = 120;

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}

export async function POST(request: NextRequest) {
  if (wantDemoFallback(request.headers, request.url)) {
    const cached = readDemoCache<Awaited<ReturnType<typeof extractKnowledgeGraphFromText>>>(DEMO_FILES.ingest);
    if (cached) return NextResponse.json(cached);
  }
  try {
    let text = '';

    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = await request.json();
      if (body.text && typeof body.text === 'string') {
        text = body.text;
      } else if (body.pdfBase64 && typeof body.pdfBase64 === 'string') {
        const buffer = Buffer.from(body.pdfBase64, 'base64');
        text = await extractTextFromPdf(buffer);
      } else {
        return NextResponse.json(
          { error: 'Provide "text" or "pdfBase64" in JSON body' },
          { status: 400 }
        );
      }
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file || file.type !== 'application/pdf') {
        return NextResponse.json({ error: 'Upload a PDF file' }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      text = await extractTextFromPdf(buffer);
    } else {
      return NextResponse.json(
        { error: 'Use application/json with "text" or "pdfBase64", or multipart/form-data with PDF' },
        { status: 400 }
      );
    }

    if (!text || text.trim().length < 50) {
      return NextResponse.json(
        { error: 'Extracted text too short. Upload a valid PDF or provide longer text.' },
        { status: 400 }
      );
    }

    const crypto = await import('crypto');
    const ingestKey = cacheKey('ingest', crypto.createHash('sha256').update(text).digest('hex').slice(0, 16));
    const cached = cacheGet<Awaited<ReturnType<typeof extractKnowledgeGraphFromText>>>(ingestKey);
    if (cached) return NextResponse.json(cached);

    const graph = await extractKnowledgeGraphFromText(text);
    cacheSet(ingestKey, graph);

    // Auto-trigger P3 bookshelf prewarm so cache is ready when user opens bookshelf
    const p3Url = process.env.P3_SCRAPER_URL;
    if (p3Url && graph.concepts?.length) {
      const topics = graph.concepts.map((c) => c.name).slice(0, 10);
      fetch(`${p3Url}/bookshelf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topics, per_topic: 3 }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    return NextResponse.json(graph);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
