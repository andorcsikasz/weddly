// Printable QR code generation. PNG by default (a couple saves it to their
// phone, drops it in Canva, or hands it to a print shop — a browser or print
// pipeline that chokes on SVG never chokes on PNG), `svg` for anyone laying
// out a table card at press resolution. Shared between the guest photo album
// and the live quiz game — same options, same output shape, one place to
// change the look.

import QRCode from "qrcode";

export async function generateQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: "#1a1a1a", light: "#ffffff" },
  });
}

/** 1024px wide — big enough to print on a table card without a soft edge. */
export async function generateQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 1024,
    color: { dark: "#1a1a1a", light: "#ffffff" },
  });
}
