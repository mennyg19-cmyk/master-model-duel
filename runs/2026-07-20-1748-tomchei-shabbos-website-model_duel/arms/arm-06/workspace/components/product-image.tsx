// Product photo or fallback glyph — the one place the upload <img> lives.
// Uploads come from the local driver or Vercel Blob, both outside next/image's
// configured domains in dev, so the plain <img> is intentional.
export function ProductImage({
  src,
  alt,
  className,
  glyphSize = 48,
}: {
  src: string | null;
  alt: string;
  className: string;
  glyphSize?: number;
}) {
  if (!src) return <PackageGlyph size={glyphSize} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- uploads come from the local driver or Blob, both outside next/image's configured domains in dev
    <img src={src} alt={alt} className={className} />
  );
}

export function PackageGlyph({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M12 3l9 5-9 5-9-5 9-5z" strokeLinejoin="round" />
      <path d="M3 8v8l9 5 9-5V8" strokeLinejoin="round" />
      <path d="M12 13v8" strokeLinecap="round" />
    </svg>
  );
}
