"use client";
import { useState } from "react";
import { ImageOff } from "lucide-react";
export function MarketplaceImage({
  src,
  alt,
  loading = "lazy",
}: {
  src: string;
  alt: string;
  loading?: "lazy" | "eager";
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return failedSrc === src ? (
    <span className="abi-market-image-fallback" role="img" aria-label={`${alt}: image unavailable`}>
      <ImageOff size={24} strokeWidth={1.3} />
      <span>Image unavailable</span>
    </span>
  ) : (
    <img
      src={src}
      alt={alt}
      loading={loading}
      width="600"
      height="450"
      onError={() => setFailedSrc(src)}
    />
  );
}
