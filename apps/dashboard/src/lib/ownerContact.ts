/**
 * Who to contact, used by the public site and the login page.
 *
 * This number was written into three files by hand. The fourth copy -- the
 * warranty page's fallback -- was a *different* number, and that mattered:
 * the server resolves its own warranty contact by falling back to the owner,
 * so with nothing configured the server messaged the owner while the page
 * showed the customer a different number to call.
 *
 * The configured value always wins; this is only what a visitor sees before
 * any settings have loaded, or if that request fails.
 */
export const OWNER_WHATSAPP = "6287777655549";

/** A `wa.me` link. Accepts a bare number or an existing URL. */
export function ownerWhatsappLink(target: string = OWNER_WHATSAPP): string {
  const digits = String(target).replace(/\D/g, "");
  return `https://wa.me/${digits || OWNER_WHATSAPP}`;
}

/**
 * The number as a person reads it, for display beside a link.
 *
 * This exists because the footer hardcoded "+62 877-7655-549" as the label of a
 * link built from `OWNER_WHATSAPP`. The two disagreed -- the label digitises to
 * 628777655549, the link dials 6287777655549. A visitor who read the number off
 * the screen and typed it into WhatsApp by hand reached somebody else, or
 * nobody at all if the missing character was not a digit.
 *
 * Formatting from the constant is what stops that recurring: the label and the
 * link are now the same value by construction. `+62` is assumed for a
 * 62-prefixed number, which is the only shape `OWNER_WHATSAPP` has; anything
 * else is returned as-is rather than guessed at.
 */
export function ownerWhatsappDisplay(target: string = OWNER_WHATSAPP): string {
  const digits = String(target).replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length > 10) {
    const local = digits.slice(2);
    return `+62 ${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return digits || OWNER_WHATSAPP;
}
