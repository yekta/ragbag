// Stage 4 prep (plan §7/§8): split extracted text into ~512-token chunks
// (≈1800 chars) with overlap, paragraph-aware so chunks stay coherent.

export type ChunkOptions = {
  maxChars?: number;
  overlap?: number;
  maxChunks?: number;
};

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const { maxChars = 1_800, overlap = 200, maxChunks = 200 } = options;
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  // Paragraph units; paragraphs longer than a chunk are split on sentences,
  // then hard-wrapped as a last resort.
  const units: string[] = [];
  for (const paragraph of clean.split(/\n{2,}/)) {
    const p = paragraph.trim();
    if (!p) continue;
    if (p.length <= maxChars) {
      units.push(p);
      continue;
    }
    let buffer = "";
    for (const sentence of p.split(/(?<=[.!?…])\s+/)) {
      if (buffer && buffer.length + sentence.length + 1 > maxChars) {
        units.push(buffer);
        buffer = "";
      }
      buffer = buffer ? `${buffer} ${sentence}` : sentence;
      while (buffer.length > maxChars) {
        units.push(buffer.slice(0, maxChars));
        buffer = buffer.slice(maxChars - overlap);
      }
    }
    if (buffer) units.push(buffer);
  }

  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current && current.length + unit.length + 2 > maxChars) {
      chunks.push(current);
      if (chunks.length >= maxChunks) return chunks;
      // Carry a tail of the previous chunk for context continuity.
      const tail = current.slice(-overlap);
      current = `${tail}\n\n${unit}`;
    } else {
      current = current ? `${current}\n\n${unit}` : unit;
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, maxChunks);
}
