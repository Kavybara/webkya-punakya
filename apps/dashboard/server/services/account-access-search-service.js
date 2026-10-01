const labelsByType = Object.freeze({
  signin: ["NF_SIGNIN"],
  verification: ["NF_VERIF"],
  reset: ["NF_RESET"],
  household: ["NF_HOUSE"],
  disney_otp: ["DISNEY_CODE"],
});

function labelsFor(type = "") {
  return labelsByType[String(type || "").trim().toLowerCase()] || [];
}

function validEmail(value = "") {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/.test(email) ? email : "";
}

export function accountAccessGmailQueries(type = "", target = "") {
  const labels = labelsFor(type);
  const email = validEmail(target);
  if (!labels.length || !email) return [];

  const addressQuery = `to:"${email}"`;
  return [
    ...labels.map((label) => `label:${label} ${addressQuery} newer_than:2d`),
    `{${addressQuery} deliveredto:"${email}" "${email}"} newer_than:2d`,
  ];
}

/* A label is a name the owner typed into Gmail, and Gmail does not promise to
 * hand it back the way it was typed. A label created as `nf_verif` in the web
 * UI comes back from IMAP as `nf_verif`; one created as `NF_Verif` comes back
 * as `NF_Verif`. `getMailboxLock` is an exact-path lookup, not a
 * case-insensitive one, so a configured `NF_VERIF` against a real `nf_verif`
 * does not open the label -- it throws, the throw is swallowed into
 * `mailboxErrors`, and the lookup carries on to All Mail.
 *
 * That failure is invisible. All Mail is searched afterwards and almost always
 * succeeds, so the message that mattered is still on the server, and the
 * result is `not_found` -- the same answer as "the customer never triggered
 * the email". Which is why a code could be sitting in `NF_VERIF` and the
 * reseller was told it was not there. */
function mailboxPathResolver(availableMailboxes) {
  const listed = (Array.isArray(availableMailboxes) ? availableMailboxes : [])
    .map((mailbox) => ({
      path: String(mailbox?.path || "").trim(),
      delimiter: String(mailbox?.delimiter || "/") || "/",
    }))
    .filter((mailbox) => mailbox.path);

  return function resolve(name) {
    const wanted = String(name || "").trim().toLowerCase();
    if (!wanted) return "";
    const exact = listed.find((mailbox) => mailbox.path.toLowerCase() === wanted);
    if (exact) return exact.path;
    // A label filed under a parent ("Kavya/NF_VERIF") is still that label. Only
    // the trailing segments are compared, and only the ones after a real
    // delimiter, so a label genuinely named "verif" is not matched by
    // "NF_VERIF".
    const suffix = listed.find((mailbox) => {
      const segments = mailbox.path.split(mailbox.delimiter).map((part) => part.trim().toLowerCase());
      return segments.includes(wanted);
    });
    return suffix ? suffix.path : "";
  };
}

/**
 * The mailboxes worth opening for one lookup: the tool's label, All Mail, and
 * the inbox.
 *
 * Every path returned is a real one from the server's own listing, except
 * `unresolved` -- which is returned alongside, not instead, so the caller can
 * tell "there is nothing in the label" from "the label is not called that".
 */
export function accountAccessMailboxPaths(type = "", availableMailboxes = []) {
  const labels = labelsFor(type);
  if (!labels.length) return { paths: [], unresolved: [] };

  const listed = Array.isArray(availableMailboxes) ? availableMailboxes : [];
  const resolve = mailboxPathResolver(listed);

  // With no listing to check against -- `client.list()` failed, or this is a
  // planning call -- the configured names are all there is. They are still
  // worth attempting: a correct guess opens the label, and a wrong one produces
  // a recorded error rather than silence.
  const resolvedLabels = listed.length
    ? labels.map((label) => resolve(label) || label)
    : [...labels];

  const allMail = listed
    .filter((mailbox) => String(mailbox?.specialUse || "").toLowerCase() === "\\all")
    .map((mailbox) => String(mailbox.path || "").trim())
    .filter(Boolean);
  const listedInbox = listed
    .filter((mailbox) => (
      String(mailbox?.specialUse || "").toLowerCase() === "\\inbox"
      || String(mailbox?.path || "").toUpperCase() === "INBOX"
    ))
    .map((mailbox) => String(mailbox.path || "").trim())
    .filter(Boolean);

  // The inbox is appended as a bare "INBOX" only when the listing did not name
  // one. A localised account reports it as "Kotak Masuk" and has no INBOX, and
  // asking for one there is a guaranteed throw that only adds noise to the
  // error list.
  const inbox = listedInbox.length ? listedInbox : ["INBOX"];

  const unresolved = listed.length
    ? labels.filter((label) => !resolve(label))
    : [];

  return {
    paths: Array.from(new Set([...resolvedLabels, ...allMail, ...inbox])),
    unresolved,
  };
}
