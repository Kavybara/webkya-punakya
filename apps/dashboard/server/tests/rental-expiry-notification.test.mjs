import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  formatRentalEndDate,
  rentalEndDateMs,
} from "../../../../packages/shared/rental-expiry.mjs";
import {
  rentalChangedNotificationText,
  rentalExpiringNotificationText,
} from "../services/whatsapp-rental-notification-service.js";

/*
 * A rental message says `Expired : 95 hari`. That is a countdown, not a date:
 * it reads fine once and means nothing after a day has passed. What someone
 * who rents asks for -- and what they cannot derive from a countdown without
 * remembering the day they were told -- is the calendar date the access stops.
 *
 * The group invite link is the other half. It was stored on every rental and
 * had never been sent to anyone, so the only copy in existence was a field in
 * a database and a text box on the owner's screen.
 */

/*
 * The invite link below is a fixture, not a group. A real `chat.whatsapp.com`
 * code is a bearer credential -- anyone holding it can join that group -- and
 * the rentals file this feature was built against holds live ones. Copying a
 * real code into a committed test would put a working key for a real customer
 * group into the repository's history, where removing it later does not remove
 * it. It is spelled so it cannot be mistaken for a real code.
 */
const FIXTURE_INVITE_LINK = "https://chat.whatsapp.com/test-link-fixture-not-a-real-group";

const db = {
  settings: { ownerWhatsAppNumber: "087777655549" },
  ownerProfile: { whatsapp: "087777655549" },
};

const rental = {
  name: "PINKOLA BABES",
  contact: "6281348596610",
  startedAt: "2026-06-01",
  endsAt: "2026-09-04",
  daysLeft: 95,
  linkGrub: FIXTURE_INVITE_LINK,
};

test("the end date is formatted as a calendar date, not a countdown", () => {
  assert.equal(formatRentalEndDate(rental), "4 September 2026");
});

test("a bare YYYY-MM-DD is read as a calendar date, never shifted by timezone", () => {
  // `new Date("2026-09-04")` parses as UTC midnight, which lands on the 3rd for
  // anyone west of Greenwich and on the 4th for everyone east. The rental's own
  // end date has no timezone -- it is a date the owner typed -- so it must be
  // read digit by digit. An off-by-one here tells someone their access ends a
  // day early or late, which is the one number they cannot check themselves.
  assert.equal(formatRentalEndDate({ endsAt: "2026-01-01" }), "1 Januari 2026");
  assert.equal(formatRentalEndDate({ endsAt: "2026-12-31" }), "31 Desember 2026");
});

test("every month name is spelled out and none are left in English", () => {
  const expected = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  for (let month = 1; month <= 12; month += 1) {
    const endsAt = `2026-${String(month).padStart(2, "0")}-15`;
    assert.equal(formatRentalEndDate({ endsAt }), `15 ${expected[month - 1]} 2026`);
  }
});

test("an epoch expiry is read in WIB, the timezone every other rental date uses", () => {
  // 2026-08-25T09:00:00Z is 16:00 in Jakarta. A rental that runs out at
  // 23:00 WIB crosses midnight in UTC; read in UTC that lands on the next day
  // and the message would say the 26th.
  const ms = Date.parse("2026-08-25T09:00:00Z");
  assert.equal(formatRentalEndDate({ expired: ms }), "25 Agustus 2026");
  assert.equal(rentalEndDateMs({ expired: ms }), ms);
});

test("the day count is the last resort, not the first", () => {
  // A real date on the record always wins. Falling back to `now + daysLeft`
  // first would re-derive an answer the record already states.
  assert.equal(formatRentalEndDate({ endsAt: "2026-09-04", daysLeft: 95 }), "4 September 2026");
});

test("a rental with no usable date produces no line rather than a wrong one", () => {
  assert.equal(formatRentalEndDate({}), "");
  assert.equal(formatRentalEndDate({ endsAt: "bukan tanggal" }), "");
  assert.equal(formatRentalEndDate({ expiresAt: "juga bukan" }), "");
});

test("the notification now states the end date", () => {
  const text = rentalChangedNotificationText({ db, rental, action: "added", addedDays: 90, totalDays: 95 });
  assert.match(text, /^Berakhir : 4 September 2026$/m);
});

test("the notification now carries the group invite link", () => {
  // This is the field the whole request was about. Before this, `linkGrub` was
  // stored on every rental and had never reached a single recipient.
  const text = rentalChangedNotificationText({ db, rental, action: "added", addedDays: 90, totalDays: 95 });
  assert.match(text, /^Link Grub : https:\/\/chat\.whatsapp\.com\/test-link-fixture-not-a-real-group$/m);
});

test("the reminder before expiry carries the link and the date too", () => {
  // Someone who gets a five-day warning with no link and no date cannot act on
  // it -- they cannot join the group or tell anyone when it ends.
  const text = rentalExpiringNotificationText(db, rental, 5);
  assert.match(text, /^Link Grub : https:\/\/chat\.whatsapp\.com\//m);
  assert.match(text, /^Berakhir : 4 September 2026$/m);
});

test("a rental with no link omits the line instead of printing a blank one", () => {
  const text = rentalChangedNotificationText({
    db,
    rental: { ...rental, linkGrub: "" },
    action: "added",
    addedDays: 90,
    totalDays: 95,
  });
  assert.doesNotMatch(text, /Link Grub/);
  assert.match(text, /^Berakhir : 4 September 2026$/m);
});

test("the link stays out of the messages posted inside the group", () => {
  /*
   * The one genuinely dangerous version of this feature.
   *
   * A WhatsApp invite link is the key to the group. `.ceksewa` is not
   * admin-only and the reply to `.sewabot` lands in the chat, so anything
   * either of them prints is readable by every member -- and forwardable to
   * anyone at all. A link there is not "shared with the person who rents"; it
   * is a copy handed to the whole member list, and it keeps working after the
   * rental ends unless someone revokes it in WhatsApp.
   *
   * The private notification is the only version of this message whose
   * recipient list is the number on the rental and nothing else.
   */
  const source = readFileSync(
    new URL("../../../../apps/bot/plugins/kavya/group-basic.js", import.meta.url),
    "utf8",
  );

  const inGroupReply = source.slice(
    source.indexOf("async function upsertCurrentGroupRental"),
    source.indexOf("function runBackupCommand"),
  );
  assert.ok(inGroupReply.length > 0, "could not find the in-group rental reply");

  // The in-group reply calls rentalMessageText without a link.
  assert.match(
    inGroupReply,
    /rentalMessageText\(\{[\s\S]*?title:[\s\S]*?groupName,[\s\S]*?ownerNumber:[\s\S]*?days:[\s\S]*?\}\)/,
    "the in-group reply shape changed; re-check that it still passes no linkGrub",
  );
  assert.doesNotMatch(
    inGroupReply,
    /linkGrub|rentalShareLink|rentalInviteLink/i,
    "the invite link is now printed into the group chat. Every member can read and forward it.",
  );

  // `.ceksewa` is readable by every member for the same reason.
  const checkRental = source.slice(
    source.indexOf("async function checkRental"),
    source.indexOf("async function listRentals"),
  );
  assert.ok(checkRental.length > 0, "could not find the .ceksewa handler");
  assert.doesNotMatch(
    checkRental,
    /linkGrub|rentalShareLink|rentalInviteLink/i,
    ".ceksewa is not admin-only, so its reply must not carry the invite link either",
  );

  // And the private notification is the one that does carry it.
  const privateNotice = source.slice(
    source.indexOf("function rentalStoreOwnerMessage"),
    source.indexOf("async function upsertCurrentGroupRental"),
  );
  assert.ok(privateNotice.length > 0, "could not find the private rental notification");
  assert.match(
    privateNotice,
    /linkGrub: rentalInviteLink\(rental\)/,
    "the private notification stopped sending the invite link, which was the point of the change",
  );
});