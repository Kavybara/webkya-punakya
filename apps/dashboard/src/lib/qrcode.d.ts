/**
 * Types for `qrcode`, narrowed to the surface `lib/qrisQr.ts` uses.
 *
 * The package ships no types of its own and its DefinitelyTyped counterpart is
 * not a dependency here. Declaring the four things we call is a smaller and
 * more honest option than installing types for an API we use once: an
 * untyped import would resolve to `any` and quietly accept a misspelled option,
 * which for a payment code is the wrong failure mode.
 *
 * The real module accepts more than this. Anything not listed here is
 * deliberately a compile error rather than a silent `any`.
 */
declare module "qrcode" {
  /** How much of the code can be obscured and still scan. */
  type QrErrorCorrectionLevel = "L" | "M" | "Q" | "H";

  export interface QrCodeToDataURLOptions {
    /** Rendered width and height in pixels. */
    width?: number;
    /** Quiet zone around the code, in modules. The spec's minimum is 4. */
    margin?: number;
    errorCorrectionLevel?: QrErrorCorrectionLevel;
    /**
     * Foreground and background. A payment code is black and white: giving the
     * library colour options is how a code ends up with a logo punched out of
     * the middle of it, which a phone camera will refuse to read.
     */
    color?: { dark?: string; light?: string };
  }

  const QRCode: {
    /**
     * Encode `text` as a PNG data URL. Resolves rather than throws on a
     * payload the encoder cannot represent; `lib/qrisQr.ts` treats the
     * rejection as "no image, caller falls back".
     */
    toDataURL(text: string, options?: QrCodeToDataURLOptions): Promise<string>;
  };

  export default QRCode;
}
