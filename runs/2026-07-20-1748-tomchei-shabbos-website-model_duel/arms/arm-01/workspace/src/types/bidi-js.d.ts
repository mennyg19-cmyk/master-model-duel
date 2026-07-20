declare module "bidi-js" {
  type EmbeddingLevels = {
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  };

  type Bidi = {
    getEmbeddingLevels(value: string, direction?: "ltr" | "rtl"): EmbeddingLevels;
    getReorderSegments(
      value: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): [number, number][];
  };

  export default function bidiFactory(): Bidi;
}
