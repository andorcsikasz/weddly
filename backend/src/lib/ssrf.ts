// Shared SSRF guard for any code path that fetches a URL derived from user
// input (wishlist link previews, supplier-website enrichment, …). The single
// source of truth for "is this address safe to fetch from": refuse non-http(s)
// schemes, refuse hostnames that are never legitimately external, and DNS-
// resolve real hostnames so an attacker-controlled domain whose A/AAAA record
// points at a private / loopback / link-local / cloud-metadata address is
// rejected before we ever connect. This isn't a full DNS-rebinding defence
// (the resolve-then-connect gap remains) but is the standard mitigation at this
// layer. Callers that follow redirects MUST re-check every hop.

import { lookup } from "node:dns/promises";
import { isDisputedSourceHost } from "./scrape_denylist";

/** Reserved / non-routable IPv4 ranges we refuse to fetch from. */
export function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Not a dotted-quad — let the caller treat it as "not an IPv4 literal".
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local 169.254/16 (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast + reserved (224+)
  return false;
}

/** Reserved IPv6 ranges (loopback, link-local, unique-local, and v4-mapped
 *  forms that would otherwise sneak a private v4 through). */
export function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
  // v4-mapped (::ffff:a.b.c.d) — extract the embedded v4 and re-check.
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1] && isBlockedIpv4(mapped[1])) return true;
  return false;
}

export function isBlockedIp(ip: string): boolean {
  return ip.includes(":") ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

/** A hostname that's never legitimate for an external link. */
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (isDisputedSourceHost(h)) return true;
  return false;
}

/** Resolve `host` and return true only when it is safe to fetch from. Handles
 *  IPv4/IPv6 literals (incl. bracketed `[::1]`) directly and DNS-resolves real
 *  hostnames, refusing if ANY resolved address is non-routable. */
export async function isPublicHost(host: string): Promise<boolean> {
  if (!host || isBlockedHostname(host)) return false;
  const literal = host.replace(/^\[|\]$/g, ""); // strip [..] for IPv6 literals
  if (/^[\d.]+$/.test(literal) || literal.includes(":")) {
    return !isBlockedIp(literal);
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(literal, { all: true });
  } catch {
    return false;
  }
  if (addrs.length === 0) return false;
  return addrs.every((a) => !isBlockedIp(a.address));
}

/** Validate the URL scheme + host and confirm it resolves to a public address.
 *  Returns the parsed URL or throws so the caller can map to a soft failure. */
export async function assertSafeFetchUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("unsupported scheme");
  }
  if (!(await isPublicHost(url.hostname))) throw new Error("blocked host");
  return url;
}
