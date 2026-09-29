import assert from "node:assert/strict";
import test from "node:test";

import { resolveSmokeTestReseller } from "../routes/order-routes.js";

test("Owner smoke test resolves only the active configured smoke reseller", () => {
  const db = {
    resellers: [
      { id: "res-kya", username: "kya", name: "Kya", isActive: true },
      { id: "res-other", username: "other", name: "Other", isActive: true },
      { id: "res-disabled", username: "disabled", name: "Disabled", isActive: false },
    ],
  };
  const isSmokeTestReseller = (reseller) => reseller.username === "kya";

  assert.equal(resolveSmokeTestReseller(db, "KYA", isSmokeTestReseller)?.id, "res-kya");
  assert.equal(resolveSmokeTestReseller(db, "other", isSmokeTestReseller), null);
  assert.equal(resolveSmokeTestReseller(db, "disabled", () => true), null);
});
