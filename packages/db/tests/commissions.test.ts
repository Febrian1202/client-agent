import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { CommissionStatus } from '@client-agent/domain';
import {
  db,
  getOwnerUserId,
  listCommissions,
  getCommissionById,
  upsertCommission,
  updateCommission,
  listClients,
  getClientById,
  listConversations,
  listAuditLogs,
  insertClient,
  insertConversation,
  insertAuditLog,
  clients,
  conversations,
  auditLogs,
} from '../src';

describe('Dashboard Database Queries', () => {
  const suffix = Date.now();
  let ownerUserId: number;
  let clientIdA: number;
  let clientIdB: number;
  let convIdA: number;
  let createdCommissionIds: number[] = [];
  let createdAuditLogIds: number[] = [];

  beforeAll(async () => {
    ownerUserId = await getOwnerUserId();

    const clientA = await insertClient({
      userId: ownerUserId,
      platform: 'vgen',
      username: `client_alice_${suffix}`,
      displayName: `Alice Wonderland ${suffix}`,
    });
    clientIdA = clientA.id;

    const clientB = await insertClient({
      userId: ownerUserId,
      platform: 'vgen',
      username: `client_bob_${suffix}`,
      displayName: `Bob Builder ${suffix}`,
    });
    clientIdB = clientB.id;

    const convA = await insertConversation({
      clientId: clientIdA,
      platform: 'vgen',
      externalId: `conv_alice_${suffix}`,
      externalUrl: `https://vgen.co/inbox/alice_${suffix}`,
    });
    convIdA = convA.id;
  });

  afterAll(async () => {
    // Clean up created commissions
    const { commissions } = await import('../src');
    if (commissions && createdCommissionIds.length > 0) {
      for (const id of createdCommissionIds) {
        await db.delete(commissions).where(eq(commissions.id, id));
      }
    }

    // Clean up audit logs
    for (const id of createdAuditLogIds) {
      await db.delete(auditLogs).where(eq(auditLogs.id, id));
    }

    // Clean up conversations & clients
    if (convIdA) {
      await db.delete(conversations).where(eq(conversations.id, convIdA));
    }
    if (clientIdA) {
      await db.delete(clients).where(eq(clients.id, clientIdA));
    }
    if (clientIdB) {
      await db.delete(clients).where(eq(clients.id, clientIdB));
    }
  });

  it('upserts and retrieves commission records with status filtering', async () => {
    const extId = `vgen_comm_${suffix}`;

    // 1. Insert new commission via upsertCommission
    const comm1 = await upsertCommission({
      clientId: clientIdA,
      externalId: extId,
      serviceName: 'Character Illustration',
      amount: '250.00',
      currency: 'USD',
      status: CommissionStatus.REQUESTED,
      metadata: { notes: 'Half body with full coloring' },
    });
    createdCommissionIds.push(comm1.id);

    expect(comm1.id).toBeDefined();
    expect(comm1.clientId).toBe(clientIdA);
    expect(comm1.externalId).toBe(extId);
    expect(comm1.serviceName).toBe('Character Illustration');
    expect(comm1.amount).toBe('250.00');
    expect(comm1.currency).toBe('USD');
    expect(comm1.status).toBe(CommissionStatus.REQUESTED);

    // 2. Retrieve by ID
    const fetched = await getCommissionById(comm1.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(comm1.id);
    expect(fetched?.serviceName).toBe('Character Illustration');

    // 3. Upsert with same externalId updates the record
    const commUpdated = await upsertCommission({
      clientId: clientIdA,
      externalId: extId,
      serviceName: 'Character Illustration (Updated)',
      amount: '300.00',
      currency: 'USD',
      status: CommissionStatus.IN_PROGRESS,
    });
    expect(commUpdated.id).toBe(comm1.id);
    expect(commUpdated.amount).toBe('300.00');
    expect(commUpdated.serviceName).toBe('Character Illustration (Updated)');
    expect(commUpdated.status).toBe(CommissionStatus.IN_PROGRESS);

    // 4. Update via updateCommission
    const patched = await updateCommission(comm1.id, {
      status: CommissionStatus.COMPLETED,
    });
    expect(patched?.id).toBe(comm1.id);
    expect(patched?.status).toBe(CommissionStatus.COMPLETED);

    // 5. Insert a second commission for client B
    const comm2 = await upsertCommission({
      clientId: clientIdB,
      externalId: `vgen_comm_b_${suffix}`,
      serviceName: 'Chibi Emote Pack',
      amount: '80.00',
      currency: 'USD',
      status: CommissionStatus.REQUESTED,
    });
    createdCommissionIds.push(comm2.id);

    // 6. Test listCommissions with status filter
    const completedList = await listCommissions({ status: CommissionStatus.COMPLETED });
    expect(completedList.some((c) => c.id === comm1.id)).toBe(true);
    expect(completedList.some((c) => c.id === comm2.id)).toBe(false);

    const requestedList = await listCommissions({ status: CommissionStatus.REQUESTED });
    expect(requestedList.some((c) => c.id === comm2.id)).toBe(true);
    expect(requestedList.some((c) => c.id === comm1.id)).toBe(false);

    // 7. Verify listCommissions includes client details
    const allForA = await listCommissions({ clientId: clientIdA });
    const target = allForA.find((c) => c.id === comm1.id);
    expect(target).toBeDefined();
    expect(target?.clientUsername).toBe(`client_alice_${suffix}`);
  });

  it('lists clients with optional search term', async () => {
    // 1. Fetch single client by ID
    const client = await getClientById(clientIdA);
    expect(client).not.toBeNull();
    expect(client?.id).toBe(clientIdA);
    expect(client?.username).toBe(`client_alice_${suffix}`);

    // 2. List clients with search by username
    const searchResultA = await listClients({ search: `alice_${suffix}` });
    expect(searchResultA.some((c) => c.id === clientIdA)).toBe(true);
    expect(searchResultA.some((c) => c.id === clientIdB)).toBe(false);

    // 3. List clients with search by displayName
    const searchResultB = await listClients({ search: `Builder ${suffix}` });
    expect(searchResultB.some((c) => c.id === clientIdB)).toBe(true);
    expect(searchResultB.some((c) => c.id === clientIdA)).toBe(false);

    // 4. List clients pagination
    const paged = await listClients({ limit: 1, offset: 0 });
    expect(paged.length).toBe(1);
  });

  it('lists conversations with client details', async () => {
    const list = await listConversations({ limit: 10 });
    expect(list.length).toBeGreaterThanOrEqual(1);

    const item = list.find((c) => c.id === convIdA);
    expect(item).toBeDefined();
    expect(item?.clientId).toBe(clientIdA);
    expect(item?.externalId).toBe(`conv_alice_${suffix}`);
    expect(item?.clientUsername).toBe(`client_alice_${suffix}`);
    expect(item?.clientDisplayName).toBe(`Alice Wonderland ${suffix}`);
    expect(item?.client?.username).toBe(`client_alice_${suffix}`);
  });

  it('lists audit logs ordered by timestamp descending', async () => {
    const actionA = `TEST_ACTION_A_${suffix}`;
    const actionB = `TEST_ACTION_B_${suffix}`;

    const log1 = await insertAuditLog({
      userId: ownerUserId,
      actorType: 'user',
      action: actionA,
      targetType: 'commission',
      targetId: 101,
      metadata: { step: 1 },
    });
    createdAuditLogIds.push(log1.id);

    // Short sleep so timestamp or id is distinct
    await new Promise((r) => setTimeout(r, 10));

    const log2 = await insertAuditLog({
      userId: ownerUserId,
      actorType: 'agent',
      action: actionB,
      targetType: 'commission',
      targetId: 102,
      metadata: { step: 2 },
    });
    createdAuditLogIds.push(log2.id);

    // 1. List all audit logs
    const logs = await listAuditLogs({ targetType: 'commission' });
    const found1Idx = logs.findIndex((l) => l.id === log1.id);
    const found2Idx = logs.findIndex((l) => l.id === log2.id);

    expect(found1Idx).toBeGreaterThan(-1);
    expect(found2Idx).toBeGreaterThan(-1);
    // log2 created after log1, so descending order means found2Idx < found1Idx
    expect(found2Idx).toBeLessThan(found1Idx);

    // 2. Filter by actorType
    const agentLogs = await listAuditLogs({ actorType: 'agent', targetType: 'commission' });
    expect(agentLogs.some((l) => l.id === log2.id)).toBe(true);
    expect(agentLogs.some((l) => l.id === log1.id)).toBe(false);
  });
});
