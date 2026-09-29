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
