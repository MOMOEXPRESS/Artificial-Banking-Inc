/**
 * Notification history for the console bell.
 *
 *   GET  /v1/guardian/notifications?limit=30&before=<id>&unread=1
 *   POST /v1/guardian/notifications/:id/read
 *   POST /v1/guardian/notifications/read-all
 *   GET  /v1/guardian/notification-settings
 *   PUT  /v1/guardian/notification-settings   (owner only)
 *
 * Org-scoped through guardianRoute like every other guardian route.
 */
import type express from "express";
import { z } from "zod";
import { notificationRecipient, notificationView } from "../notifications.js";
import { store, type OrgRow } from "../store.js";

type GuardianRoute = (
  handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;

export function registerNotificationRoutes(
  app: express.Express,
  deps: { guardianRoute: GuardianRoute },
): void {
  const { guardianRoute } = deps;

  app.get(
    "/v1/guardian/notifications",
    guardianRoute((org, req, res) => {
      const q = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(30),
          before: z.coerce.number().int().positive().optional(),
          unread: z.enum(["0", "1", "true", "false"]).optional(),
        })
        .parse(req.query);
      const unreadOnly = q.unread === "1" || q.unread === "true";
      const rows = store.listNotifications(org.id, {
        limit: q.limit,
        before: q.before,
        unreadOnly,
      });
      res.json({
        notifications: rows.map(notificationView),
        unreadCount: store.countUnreadNotifications(org.id),
        nextBefore: rows.length === q.limit ? rows[rows.length - 1]!.id : null,
      });
    }),
  );

  app.post(
    "/v1/guardian/notifications/read-all",
    guardianRoute((org, _req, res) => {
      const marked = store.markAllNotificationsRead(org.id);
      res.json({ ok: true, marked, unreadCount: 0 });
    }),
  );

  app.post(
    "/v1/guardian/notifications/:id/read",
    guardianRoute((org, req, res) => {
      const idNum = Number(req.params.id);
      if (!Number.isInteger(idNum) || idNum <= 0) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Bad id" } });
      }
      if (!store.markNotificationRead(org.id, idNum)) {
        return res.status(404).json({ error: { code: "NOT_FOUND" } });
      }
      res.json({ ok: true, unreadCount: store.countUnreadNotifications(org.id) });
    }),
  );

  app.get(
    "/v1/guardian/notification-settings",
    guardianRoute((org, _req, res) => {
      const settings = store.getNotificationSettings(org.id);
      res.json({
        settings: {
          email: settings.email,
          emailEnabled: settings.emailEnabled,
          ownerEmail: store.getOrgOwnerEmail(org.id),
          effectiveRecipient: notificationRecipient(org.id),
        },
      });
    }),
  );

  app.put(
    "/v1/guardian/notification-settings",
    guardianRoute(
      (org, req, res) => {
        const body = z
          .object({
            email: z.string().trim().email().max(254).nullable().optional(),
            emailEnabled: z.boolean().optional(),
          })
          .parse(req.body);
        const settings = store.setNotificationSettings(org.id, {
          email: body.email === undefined ? undefined : (body.email?.toLowerCase() ?? null),
          emailEnabled: body.emailEnabled,
        });
        res.json({
          settings: {
            ...settings,
            ownerEmail: store.getOrgOwnerEmail(org.id),
            effectiveRecipient: notificationRecipient(org.id),
          },
        });
      },
      { ownerOnly: true },
    ),
  );
}
