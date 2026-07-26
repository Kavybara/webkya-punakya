import { createServer } from "node:http";
import { html, json, readJsonBody } from "../lib/http.js";

function isAuthorized(config, req) {
  if (!config.token) {
    return false;
  }

  const header = String(req.headers.authorization || "").trim();
  return header === `Bearer ${config.token}`;
}

export function createHttpServer({ config, connection }) {
  return createServer(async (req, res) => {
    const method = req.method || "GET";
    const url = req.url || "/";
    const pathname = new URL(url, "http://localhost").pathname;

    if (pathname === "/health") {
      return json(res, 200, connection.getHealthPayload());
    }

    if (!isAuthorized(config, req)) {
      return json(res, 401, { success: false, error: "unauthorized" });
    }

    if (pathname === "/session/status" && method === "GET") {
      return json(res, 200, connection.getStatusPayload());
    }

    if (pathname === "/session/qr" && method === "GET") {
      return html(res, 200, connection.renderQrPage());
    }

    if (pathname === "/messages/send" && method === "POST") {
      try {
        const body = await readJsonBody(req);
        const to = String(body.to || "").trim();
        const text = String(body.text || "").trim();
        const imageUrl = String(body.image_url || body.imageUrl || "").trim();
        const mediaPath = String(body.media_path || body.mediaPath || "").trim();
        const documentPath = String(body.document_path || body.documentPath || "").trim();
        const fileName = String(body.file_name || body.fileName || "").trim();

        if (!to || (!text && !imageUrl && !mediaPath && !documentPath)) {
          return json(res, 400, { success: false, error: "to_and_text_required" });
        }

        const sentMessage = await connection.sendMessage(to, text, imageUrl, mediaPath, documentPath, fileName);
        return json(res, 200, {
          success: true,
          message_key: sentMessage?.key || sentMessage?.message_key || sentMessage?.messageKey || null,
        });
      } catch (error) {
        return json(res, 500, {
          success: false,
          error: error.message || "send_failed",
        });
      }
    }

    if (pathname === "/messages/delete" && method === "POST") {
      try {
        const body = await readJsonBody(req);
        const to = String(body.to || "").trim();
        const messageKey = body.messageKey || body.message_key || null;

        if (!to || !messageKey) {
          return json(res, 400, { success: false, error: "to_and_message_key_required" });
        }

        const deletedMessage = await connection.deleteMessage(to, messageKey);
        return json(res, 200, {
          success: true,
          message_key: deletedMessage?.key || deletedMessage?.message_key || deletedMessage?.messageKey || null,
        });
      } catch (error) {
        return json(res, 500, {
          success: false,
          error: error.message || "delete_failed",
        });
      }
    }

    if (pathname === "/groups/inspect" && method === "POST") {
      try {
        const body = await readJsonBody(req);
        const info = await connection.inspectGroupInvite(body.invite_link || body.inviteLink || "");
        return json(res, 200, { success: true, ...info });
      } catch (error) {
        return json(res, 500, {
          success: false,
          error: error.message || "group_inspect_failed",
        });
      }
    }

    if (pathname === "/groups/join" && method === "POST") {
      try {
        const body = await readJsonBody(req);
        const info = await connection.joinGroupInvite(body.invite_link || body.inviteLink || "");
        return json(res, 200, { success: true, ...info });
      } catch (error) {
        return json(res, 500, {
          success: false,
          error: error.message || "group_join_failed",
        });
      }
    }

    if (pathname === "/groups/sync" && method === "POST") {
      try {
        const result = await connection.syncJoinedGroups("manual-owner-sync");
        return json(res, 200, result);
      } catch (error) {
        return json(res, 500, {
          success: false,
          error: error.message || "group_sync_failed",
        });
      }
    }

    return json(res, 404, { success: false, error: "not_found" });
  });
}
