import { Elysia, t } from 'elysia';
import {
  db,
  users,
  eq,
  getOwnerUserId,
  draftService as defaultDraftService,
  getDraftWithContext,
  getDraftById,
  getApprovalsByDraftId,
  listDrafts,
} from '@client-agent/db';
import {
  DraftNotFoundError,
  InvalidDraftStateError,
  DraftContentEmptyError,
  type DraftService,
} from '@client-agent/domain';
import { authPlugin } from '../auth/plugin';
import { getSession } from '../auth/session';

export interface DraftRoutesDeps {
  draftService?: DraftService;
}

export function createDraftRoutes(deps?: DraftRoutesDeps) {
  const service = deps?.draftService ?? defaultDraftService;

  return new Elysia({ prefix: '/api/v1/drafts' })
    .use(authPlugin)
    .derive(async ({ cookie: { session } }) => {
      const sessionId = typeof session?.value === 'string' ? session.value : '';
      if (!sessionId) return { currentUser: null };

      const sessionData = await getSession(sessionId);
      if (!sessionData) return { currentUser: null };

      const userList = await db.select().from(users).where(eq(users.id, sessionData.userId));
      return { currentUser: userList[0] ?? null };
    })
    .onError(({ error, set }) => {
      if (error instanceof DraftNotFoundError) {
        set.status = 404;
        return {
          error: {
            code: 'DRAFT_NOT_FOUND',
            message: error.message,
          },
        };
      }
      if (error instanceof InvalidDraftStateError) {
        set.status = 409;
        return {
          error: {
            code: 'INVALID_DRAFT_STATE',
            message: error.message,
          },
        };
      }
      if (error instanceof DraftContentEmptyError) {
        set.status = 400;
        return {
          error: {
            code: 'DRAFT_CONTENT_EMPTY',
            message: error.message,
          },
        };
      }
    })
    .get(
      '/',
      async ({ query }) => {
        const convIdRaw = query.conversation_id ?? query.conversationId;
        const convId = convIdRaw ? parseInt(convIdRaw, 10) : undefined;
        const limitRaw = query.limit ? parseInt(query.limit, 10) : undefined;
        const offsetRaw = query.offset ? parseInt(query.offset, 10) : undefined;

        const drafts = await listDrafts({
          status: query.status,
          conversationId: convId && !Number.isNaN(convId) ? convId : undefined,
          limit: limitRaw && !Number.isNaN(limitRaw) ? limitRaw : undefined,
          offset: offsetRaw && !Number.isNaN(offsetRaw) ? offsetRaw : undefined,
        });

        return { drafts };
      },
      {
        query: t.Object({
          status: t.Optional(t.String()),
          conversation_id: t.Optional(t.String()),
          conversationId: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
      }
    )
    .get(
      '/:id',
      async ({ params, set }) => {
        const draftId = Number(params.id);
        const context = await getDraftWithContext(draftId);
        if (!context) {
          const draft = await getDraftById(draftId);
          if (!draft) {
            set.status = 404;
            return {
              error: {
                code: 'DRAFT_NOT_FOUND',
                message: `Draft with ID ${draftId} not found`,
              },
            };
          }
          const approvals = await getApprovalsByDraftId(draftId);
          return { draft, conversation: null, approvals };
        }
        return context;
      },
      {
        params: t.Object({
          id: t.Numeric(),
        }),
      }
    )
    .post(
      '/',
      async ({ body, currentUser, set }) => {
        const conversationId = Number(body.conversationId);
        const userId = currentUser?.id ?? (await getOwnerUserId());

        try {
          const draft = await service.createDraft({
            conversationId,
            content: body.content,
            userId,
          });

          set.status = 201;
          return { draft };
        } catch (error) {
          if (error instanceof DraftContentEmptyError) {
            set.status = 400;
            return {
              error: {
                code: 'DRAFT_CONTENT_EMPTY',
                message: error.message,
              },
            };
          }
          throw error;
        }
      },
      {
        body: t.Object({
          conversationId: t.Numeric(),
          content: t.String({ minLength: 1 }),
        }),
      }
    )
    .patch(
      '/:id',
      async ({ params, body, currentUser, set }) => {
        const draftId = Number(params.id);
        const userId = currentUser?.id ?? (await getOwnerUserId());

        try {
          const draft = await service.updateDraftContent({
            draftId,
            newContent: body.content,
            userId,
          });

          set.status = 200;
          return { draft };
        } catch (error) {
          if (error instanceof DraftNotFoundError) {
            set.status = 404;
            return {
              error: {
                code: 'DRAFT_NOT_FOUND',
                message: error.message,
              },
            };
          }
          if (error instanceof InvalidDraftStateError) {
            set.status = 409;
            return {
              error: {
                code: 'INVALID_DRAFT_STATE',
                message: error.message,
              },
            };
          }
          if (error instanceof DraftContentEmptyError) {
            set.status = 400;
            return {
              error: {
                code: 'DRAFT_CONTENT_EMPTY',
                message: error.message,
              },
            };
          }
          throw error;
        }
      },
      {
        params: t.Object({
          id: t.Numeric(),
        }),
        body: t.Object({
          content: t.String({ minLength: 1 }),
        }),
      }
    )
    .post(
      '/:id/approve',
      async ({ params, currentUser, set }) => {
        const draftId = Number(params.id);
        const userId = currentUser?.id ?? (await getOwnerUserId());

        try {
          const draft = await service.approveDraft({
            draftId,
            userId,
          });

          set.status = 200;
          return { draft };
        } catch (error) {
          if (error instanceof DraftNotFoundError) {
            set.status = 404;
            return {
              error: {
                code: 'DRAFT_NOT_FOUND',
                message: error.message,
              },
            };
          }
          if (error instanceof InvalidDraftStateError) {
            set.status = 409;
            return {
              error: {
                code: 'INVALID_DRAFT_STATE',
                message: error.message,
              },
            };
          }
          throw error;
        }
      },
      {
        params: t.Object({
          id: t.Numeric(),
        }),
      }
    )
    .post(
      '/:id/reject',
      async ({ params, body, currentUser, set }) => {
        const draftId = Number(params.id);
        const userId = currentUser?.id ?? (await getOwnerUserId());

        try {
          const draft = await service.rejectDraft({
            draftId,
            userId,
            reason: body?.reason,
          });

          set.status = 200;
          return { draft };
        } catch (error) {
          if (error instanceof DraftNotFoundError) {
            set.status = 404;
            return {
              error: {
                code: 'DRAFT_NOT_FOUND',
                message: error.message,
              },
            };
          }
          if (error instanceof InvalidDraftStateError) {
            set.status = 409;
            return {
              error: {
                code: 'INVALID_DRAFT_STATE',
                message: error.message,
              },
            };
          }
          throw error;
        }
      },
      {
        params: t.Object({
          id: t.Numeric(),
        }),
        body: t.Optional(
          t.Object({
            reason: t.Optional(t.String()),
          })
        ),
      }
    );
}

export const draftRoutes = createDraftRoutes();
