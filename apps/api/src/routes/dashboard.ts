import { Elysia } from 'elysia';
import { eq, ne, and, gte, inArray, desc, sql } from 'drizzle-orm';
import {
  db,
  commissions,
  clients,
  conversations,
  messages,
  drafts,
  listDrafts,
} from '@client-agent/db';
import { CommissionStatus, DraftStatus } from '@client-agent/domain';
import { authPlugin } from '../auth/plugin';

export function createDashboardRoutes() {
  return new Elysia({ prefix: '/api/v1/dashboard' })
    .use(authPlugin)
    .get(
      '/summary',
      async () => {
        const activeStatuses = [
          CommissionStatus.IN_PROGRESS,
          CommissionStatus.ACCEPTED,
          CommissionStatus.PAID,
          'active',
          'in_progress',
          'accepted',
          'paid',
        ];

        const inQueueStatuses = [
          CommissionStatus.REQUESTED,
          'in_queue',
          'requested',
        ];

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const [activeRes, inQueueRes, completedRes, pendingDraftRes] = await Promise.all([
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(commissions)
            .where(inArray(commissions.status, activeStatuses)),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(commissions)
            .where(inArray(commissions.status, inQueueStatuses)),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(commissions)
            .where(
              and(
                eq(commissions.status, CommissionStatus.COMPLETED),
                gte(commissions.updatedAt, startOfMonth)
              )
            ),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(drafts)
            .where(eq(drafts.status, DraftStatus.PENDING_APPROVAL)),
        ]);

        const activeCount = activeRes[0]?.count ?? 0;
        const inQueueCount = inQueueRes[0]?.count ?? 0;
        const completedMonthCount = completedRes[0]?.count ?? 0;
        const pendingDraftCount = pendingDraftRes[0]?.count ?? 0;

        const [pipelineRows, recentMessagesRows, pendingDrafts] = await Promise.all([
          db
            .select({
              commission: commissions,
              clientUsername: clients.username,
              clientDisplayName: clients.displayName,
              clientAvatarUrl: clients.avatarUrl,
            })
            .from(commissions)
            .leftJoin(clients, eq(commissions.clientId, clients.id))
            .where(ne(commissions.status, CommissionStatus.CANCELLED))
            .orderBy(desc(commissions.createdAt))
            .limit(20),
          db
            .select({
              id: messages.id,
              conversationId: messages.conversationId,
              externalId: messages.externalId,
              direction: messages.direction,
              senderType: messages.senderType,
              senderName: messages.senderName,
              content: messages.content,
              metadata: messages.metadata,
              sentAt: messages.sentAt,
              createdAt: messages.createdAt,
              updatedAt: messages.updatedAt,
              clientUsername: clients.username,
              clientDisplayName: clients.displayName,
              clientAvatarUrl: clients.avatarUrl,
            })
            .from(messages)
            .leftJoin(conversations, eq(messages.conversationId, conversations.id))
            .leftJoin(clients, eq(conversations.clientId, clients.id))
            .orderBy(desc(messages.createdAt), desc(messages.id))
            .limit(10),
          listDrafts({
            status: DraftStatus.PENDING_APPROVAL,
            limit: 10,
          }),
        ]);

        const activeCommissions = pipelineRows.map((r) => ({
          ...r.commission,
          clientUsername: r.clientUsername ?? undefined,
          clientDisplayName: r.clientDisplayName ?? undefined,
          clientAvatarUrl: r.clientAvatarUrl ?? undefined,
        }));

        return {
          metrics: {
            activeCount,
            inQueueCount,
            completedMonthCount,
            pendingDraftCount,
          },
          commissions: activeCommissions,
          activeCommissions,
          recentMessages: recentMessagesRows,
          pendingDrafts,
        };
      },
      {
        isAuth: true,
      }
    );
}

export const dashboardRoutes = createDashboardRoutes();
