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

export function accountAccessMailboxPaths(type = "", availableMailboxes = []) {
  const labels = labelsFor(type);
  if (!labels.length) return [];

  const listed = Array.isArray(availableMailboxes) ? availableMailboxes : [];
  const allMail = listed
    .filter((mailbox) => String(mailbox?.specialUse || "").toLowerCase() === "\\all")
    .map((mailbox) => String(mailbox.path || "").trim())
    .filter(Boolean);
  const inbox = listed
    .filter((mailbox) => (
      String(mailbox?.specialUse || "").toLowerCase() === "\\inbox"
      || String(mailbox?.path || "").toUpperCase() === "INBOX"
    ))
    .map((mailbox) => String(mailbox.path || "").trim())
    .filter(Boolean);

  return Array.from(new Set([...labels, ...allMail, ...inbox, "INBOX"]));
}
