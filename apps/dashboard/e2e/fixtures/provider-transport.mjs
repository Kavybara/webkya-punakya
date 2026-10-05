// Imported only into isolated E2E server processes. No request reaches a real provider.
import fs from "node:fs";
import path from "node:path";
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.hostname === "app.pakasir.com") {
    const body = JSON.parse(options.body || "{}");
    const amount = Number(body.amount || url.searchParams.get("amount"));
    const orderId = body.order_id || url.searchParams.get("order_id");
    return Response.json({ payment: { order_id: orderId, amount, fee: 100, total_payment: amount + 100,
      payment_number: "fixture-qris", payment_method: "qris", status: url.pathname.includes("transactiondetail") ? "completed" : "pending", completed_at: new Date().toISOString() } });
  }
  if (url.hostname === "127.0.0.1" && url.port === "1") {
    if (process.env.E2E_TRANSPORT_AUDIT === "1" && url.pathname === "/messages/send") {
      const directory = path.dirname(process.env.DATABASE_PATH || "");
      if (!path.basename(directory).startsWith("kavya-boot-")) throw new Error("e2e_audit_directory_not_isolated");
      const body = JSON.parse(options.body || "{}");
      fs.appendFileSync(path.join(directory, "provider-messages.jsonl"), `${JSON.stringify({ to: body.to, text: body.text })}\n`, { mode: 0o600 });
    }
    return Response.json({ success: true, sent: true, connected: true });
  }
  throw new Error("e2e_external_network_blocked");
};
