import test from "node:test";
import assert from "node:assert/strict";

import {
  rentalChangedNotificationText,
  rentalExpiringNotificationText,
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
    "",
    "Untuk Mengecek status sewa ketik .ceksewa pada grub tersebut",
  ].join("\n"));
});
