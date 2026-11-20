"use client";
import { useEffect, useRef, useState } from "react";
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
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // Cached failures can finish before hydration attaches onError.
    if (image.current?.complete && image.current.naturalWidth === 0) setFailedSrc(src);
  }, [src]);
  return failedSrc === src ? (
    <span
      className="abi-market-image-fallback"
      role={alt ? "img" : undefined}
      aria-hidden={!alt || undefined}
      aria-label={alt ? `${alt}: image unavailable` : undefined}
    >
      <ImageOff size={24} strokeWidth={1.3} />
      <span>Image unavailable</span>
    </span>
  ) : (
    <img
      ref={image}
      src={src}
      alt={alt}
      loading={loading}
      width="600"
      height="450"
      onError={() => setFailedSrc(src)}
    />
  );
}
