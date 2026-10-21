import { Elysia, t } from 'elysia';
import {
  getCommissionById,
  listCommissions,
  updateCommission,
} from '@client-agent/db';
import { authPlugin } from '../auth/plugin';

export function createCommissionRoutes() {
  return new Elysia({ prefix: '/api/v1/commissions' })
    .use(authPlugin)
    .get(
      '/',
      async ({ query }) => {
        const rawLimit = query.limit ? parseInt(query.limit, 10) : undefined;
        const rawOffset = query.offset ? parseInt(query.offset, 10) : undefined;
        const rawClientId = query.clientId ?? query.client_id;
        const parsedClientId = rawClientId ? parseInt(rawClientId, 10) : undefined;

        const limit = rawLimit !== undefined && !Number.isNaN(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : undefined;
        const offset = rawOffset !== undefined && !Number.isNaN(rawOffset) ? Math.max(0, rawOffset) : undefined;
        const clientId = parsedClientId !== undefined && !Number.isNaN(parsedClientId) ? parsedClientId : undefined;

        const commissions = await listCommissions({
          status: query.status,
          clientId,
          limit,
          offset,
        });

        return {
          commissions,
          data: commissions,
        };
      },
      {
        isAuth: true,
        query: t.Object({
          status: t.Optional(t.String()),
          clientId: t.Optional(t.String()),
          client_id: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
      }
    )
    .get(
      '/:id',
      async ({ params, set }) => {
        const commissionId = Number(params.id);
        if (Number.isNaN(commissionId) || commissionId <= 0) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_COMMISSION_ID',
              message: 'Commission ID must be a positive integer',
            },
          };
        }

        const commission = await getCommissionById(commissionId);
        if (!commission) {
          set.status = 404;
          return {
            error: {
              code: 'NOT_FOUND',
              message: 'Commission not found',
            },
          };
        }

        return { commission };
      },
      {
        isAuth: true,
        params: t.Object({
          id: t.Numeric(),
        }),
      }
    )
    .patch(
      '/:id',
      async ({ params, body, set }) => {
        const commissionId = Number(params.id);
        if (Number.isNaN(commissionId) || commissionId <= 0) {
          set.status = 400;
          return {
            error: {
              code: 'INVALID_COMMISSION_ID',
              message: 'Commission ID must be a positive integer',
            },
          };
        }

        const existing = await getCommissionById(commissionId);
        if (!existing) {
          set.status = 404;
          return {
            error: {
              code: 'NOT_FOUND',
              message: 'Commission not found',
            },
          };
        }

        const updated = await updateCommission(commissionId, body as Record<string, unknown>);
        return { commission: updated };
      },
      {
        isAuth: true,
        params: t.Object({
          id: t.Numeric(),
        }),
        body: t.Partial(
          t.Object({
            clientId: t.Number(),
            externalId: t.Nullable(t.String()),
            serviceName: t.String(),
            amount: t.String(),
            currency: t.String(),
            estimatedStart: t.Nullable(t.String()),
            guaranteedDelivery: t.Nullable(t.String()),
            status: t.String(),
            metadata: t.Record(t.String(), t.Any()),
          })
        ),
      }
    );
}

export const commissionRoutes = createCommissionRoutes();
