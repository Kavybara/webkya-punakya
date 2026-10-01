import { createServer } from "node:http";
import { html, json, readJsonBody } from "../lib/http.js";

/**
 * A WhatsApp JID suffix that addresses a group or a broadcast list rather than
 * one person.
 *
 * `/messages/send` is a generic "message any chat" primitive guarded by a single
 * shared bearer token, with no rate limit and no allowlist on the far side. Left
 * open to groups, it is a broadcast gun pointed at live customer groups: each
 * send is serialised through a 750ms queue with up to six retries, so a loop
 * drives roughly 1.3 messages a second into rooms full of customers who never
 * asked to be in a mailing list.
 *
 * Nothing legitimate needs it. Every caller is the dashboard, and all six of its
 * sends go to a person's number -- password-reset OTPs, registration OTPs, and
 * two reseller welcome messages. Not one of them targets a group. So this is not
 * a capability being taken away; it is a capability that was never used, made
 * explicit so that a leaked token cannot turn it into one.
 *
 * `@broadcast` and `@newsletter` are the other two ways to address many people
 * at once, and are denied for the same reason. `@s.whatsapp.net` (a person) and
 * `@lid` (WhatsApp's privacy-preserving alias for a person) stay allowed --
 * `@lid` is what a modern save can hand back instead of the real number, so
 * denying it would quietly break delivery to some legitimate recipients.
 */
const GROUP_JID_SUFFIXES = ["@g.us", "@broadcast", "@newsletter"];

function isGroupTarget(value) {
  const target = String(value || "").trim().toLowerCase();
  return GROUP_JID_SUFFIXES.some((suffix) => target.endsWith(suffix));
}

/**
 * Strip member phone numbers off a group record.
 *
 * `/groups/sync` used to hand back the full roster of every group the bot is in,
 * behind the same token that guards `/messages/send`. Anyone holding that token
 * could read the complete member list of every live customer group, and the
 * dashboard -- the only real consumer -- never called this route at all. The
 * summary fields are all the caller needs; the roster is not in the response.
 */
function withoutParticipants(groups = []) {
  return (Array.isArray(groups) ? groups : []).map((group) => {
    if (!group || typeof group !== "object") return group;
    const { participants, ...rest } = group;
    return rest;
  });
}

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

        // Group and broadcast targets are refused here rather than further down,
        // so nothing downstream has to be trusted to remember the rule.
        if (isGroupTarget(to)) {
          return json(res, 400, { success: false, error: "group_target_not_allowed" });
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
        // The roster comes back in `result.groups` and is stripped before it
        // leaves the process -- see `withoutParticipants`.
        return json(res, 200, { ...result, groups: withoutParticipants(result?.groups) });
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
