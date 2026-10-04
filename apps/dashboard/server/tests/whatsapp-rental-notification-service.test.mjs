import test from "node:test";
import assert from "node:assert/strict";

import {
  rentalChangedNotificationText,
  rentalExpiringNotificationText,
  rentalExpiredNotificationText,
} from "../services/whatsapp-rental-notification-service.js";

const db = {
  settings: { ownerWhatsAppNumber: "087777655549" },
  ownerProfile: { whatsapp: "087777655549" },
};

const rental = {
  name: "PINKOLA BABES 🍓",
  contact: "6281348596610",
  startedAt: "2026-06-01",
  endsAt: "2026-09-04",
  daysLeft: 95,
  linkGrub: "https://chat.whatsapp.com/test-link-fixture-not-a-real-group",
};

test("rental added notification uses the owner-facing WhatsApp format", () => {
  assert.equal(rentalChangedNotificationText({
    db,
    rental,
    action: "added",
    addedDays: 90,
    totalDays: 95,
  }), [
    "Bot Sewa Bertambah",
    "",
    "Name Grub : PINKOLA BABES 🍓",
    "Nomor Owner : 6281348596610",
    "Penambahan Hari : 90 hari",
    "Expired : 95 hari",
    "Berakhir : 4 September 2026",
    "Link Grub : https://chat.whatsapp.com/test-link-fixture-not-a-real-group",
    "",
    "Untuk Mengecek status sewa ketik .ceksewa pada grub tersebut",
  ].join("\n"));
});

test("rental reduced notification shows reduced days and current remaining time", () => {
  assert.equal(rentalChangedNotificationText({
    db,
    rental,
    action: "reduced",
    addedDays: -30,
    totalDays: 65,
  }), [
    "Bot Sewa Berkurang",
    "",
    "Name Grub : PINKOLA BABES 🍓",
    "Nomor Owner : 6281348596610",
    "Pengurangan Hari : 30 hari",
    "Expired : 65 hari",
    "Berakhir : 4 September 2026",
    "Link Grub : https://chat.whatsapp.com/test-link-fixture-not-a-real-group",
    "",
    "Untuk Mengecek status sewa ketik .ceksewa pada grub tersebut",
  ].join("\n"));
});

test("five day rental reminder uses warning title and remaining days", () => {
  assert.equal(rentalExpiringNotificationText(db, rental, 5), [
    "Sewa Bot Hampir Berakhir",
    "",
    "Name Grub : PINKOLA BABES 🍓",
    "Nomor Owner : 6281348596610",
    "Waktu Tersisa : 5 hari",
    "Berakhir : 4 September 2026",
    "Link Grub : https://chat.whatsapp.com/test-link-fixture-not-a-real-group",
    "",
    "Untuk Mengecek status sewa ketik .ceksewa pada grub tersebut",
  ].join("\n"));
});

test("an adjusted rental announces the new end date, not the one it just left", () => {
  // After a duration change the payload's `rental` is the record as it was
  // *before* the adjustment, so preferring `rental.endsAt` here would tell
  // someone their rental ends on a date that has already moved.
  assert.match(
    rentalChangedNotificationText({
      db,
      rental,
      action: "reduced",
      addedDays: -30,
      totalDays: 65,
      newEndsAt: "2026-08-05",
    }),
    /^Berakhir : 5 Agustus 2026$/m,
  );
});

test("the expired notice states when it ended but never hands out the invite", () => {
  // Sending the invite after a rental lapses is sending a key to someone who
  // has just lost the right to the door.
  const text = rentalExpiredNotificationText(db, rental);
  assert.match(text, /^Berakhir : 4 September 2026$/m);
  assert.doesNotMatch(text, /Link Grub/);
});
