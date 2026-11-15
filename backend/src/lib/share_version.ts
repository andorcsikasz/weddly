// Short stable hash of the fields a share card (or any `?v=` cache-buster) is
// drawn from. The same value keys the render cache and the URL, so an edit
// changes both at once. Lives in lib/ so SEO head code can use it without
// importing the card renderer.

export function shareVersion(parts: Array<string | null | undefined>): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(parts.map((p) => p ?? "").join("\u0001"));
  return h.digest("hex").slice(0, 12);
}
