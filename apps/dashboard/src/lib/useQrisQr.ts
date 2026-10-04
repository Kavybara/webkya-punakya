import { useEffect, useState } from "react";
import { qrisQrDataUrl } from "./qrisQr";

/**
 * A QRIS code for `payload`, as an image source, drawn on this machine.
 *
 * The empty string means "not ready yet" *and* "there was nothing to encode",
 * so a caller cannot tell them apart -- which is why the two states that matter
 * to a reader are handled where the image is placed: a `loading` code shows a
 * placeholder, and a payment with no payload at all shows the direct link
 * instead. Neither is a case where a spinner would be wrong forever.
 *
 * The effect is keyed on the payload, so switching from one pending order to
 * another discards the first code rather than showing it under the second
 * order's heading for a frame.
 */
export function useQrisQr(payload: string | null | undefined): string {
  const [source, setSource] = useState("");

  useEffect(() => {
    const value = String(payload || "").trim();
    if (!value) {
      setSource("");
      return undefined;
    }
    let current = true;
    setSource("");
    // `qrisQrDataUrl` catches internally and resolves "" on a payload the
    // encoder rejects, so there is no rejection to handle here.
    void qrisQrDataUrl(value).then((url) => {
      if (current) setSource(url);
    });
    return () => {
      current = false;
    };
  }, [payload]);

  return source;
}
