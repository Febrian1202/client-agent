import { describe, expect, it } from 'bun:test';
import {
  computeMetricCards,
  filterCommissionsByTab,
  computeTabCounts,
  formatCommissionCard,
  formatRelativeTime,
  getDraftApprovalContext,
  getClientMemoryProfile,
  type CommissionFilterTab,
  DEFAULT_SAMPLE_COMMISSIONS,
  DEFAULT_SAMPLE_DRAFTS,
  DEFAULT_SAMPLE_MESSAGES,
} from '../src/lib/dashboard';
import type { DashboardSummary, CommissionItem, DraftItem, MessageItem } from '../src/lib/api';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Dashboard Overview Data Mapping & Logic', () => {
  const mockSummary: DashboardSummary = {
    metrics: {
      activeCount: 5,
      inQueueCount: 3,
      completedMonthCount: 18,
      pendingDraftCount: 3,
    },
    commissions: [
      {
        id: 101,
        clientId: 1,
        externalId: 'VG-8941',
        serviceName: 'Live2D Character Model Full Rig',
        amount: '850.00',
        currency: 'USD',
        status: 'in_progress',
        clientUsername: 'KitsuneMei',
        clientDisplayName: 'Mei • Kitsune VTuber',
        guaranteedDelivery: '2026-10-28T00:00:00.000Z',
        metadata: {
          clientNote:
            'Full commercial streaming rights included. Primary color palette: royal purple and gold trim. Please see PSD link for reference sketches.',
        },
        createdAt: '2026-10-15T10:00:00.000Z',
        updatedAt: '2026-10-20T12:00:00.000Z',
      },
      {
        id: 102,
        clientId: 2,
        externalId: 'VG-8942',
        serviceName: 'Chibi Character Emote Pack (x6)',
        amount: '180.00',
        currency: 'USD',
        status: 'requested',
        clientUsername: 'StarlightVT',
        clientDisplayName: 'Starlight Ch.',
        guaranteedDelivery: '2026-11-05T00:00:00.000Z',
        metadata: {
          clientNote:
            'Looking for 6 expressions: hype, cry, heart, sip, rage, gg. Twitch 112px canvas.',
        },
        createdAt: '2026-10-18T14:30:00.000Z',
        updatedAt: '2026-10-18T14:30:00.000Z',
      },
      {
        id: 103,
        clientId: 3,
        externalId: 'VG-8943',
        serviceName: 'Vtuber Outfit Redesign & Illustration',
        amount: '420.00',
        currency: 'USD',
        status: 'delivered',
        clientUsername: 'NekoRider',
        clientDisplayName: 'Neko Rider',
        guaranteedDelivery: '2026-10-20T00:00:00.000Z',
        metadata: {
          clientNote: 'Cyberpunk biker theme. High-res transparent PNGs needed.',
        },
        createdAt: '2026-10-01T09:00:00.000Z',
        updatedAt: '2026-10-20T08:00:00.000Z',
      },
    ],
    activeCommissions: [],
    recentMessages: [
      {
        id: 501,
        conversationId: 10,
        direction: 'inbound',
        senderType: 'client',
        senderName: 'KitsuneMei',
        clientUsername: 'KitsuneMei',
        content: 'Hi Erian! Just checking if the eye rigging sketch is ready?',
        sentAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
        createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      },
    ],
    pendingDrafts: [
      {
        id: 301,
        conversationId: 10,
        content:
          'Hi Mei! Yes, the eye physics and blink physics layers are completed. I will upload the preview video today by 6 PM JST (UTC+9).',
        status: 'pending_approval',
        clientUsername: 'KitsuneMei',
        createdAt: '2026-10-21T02:00:00.000Z',
        updatedAt: '2026-10-21T02:00:00.000Z',
      },
    ],
  };

  it('correctly maps 4 top metric cards with labels, subtitles, and badges', () => {
    const cards = computeMetricCards(mockSummary);

    expect(cards).toHaveLength(4);

    // Card 1: Active Commissions
    expect(cards[0].title).toBe('Active Commissions');
    expect(cards[0].value).toContain('5 Active');
    expect(cards[0].subtitle).toContain('pipeline');
    expect(cards[0].badgeText).toBe('In Progress');

    // Card 2: In Queue / Requested
    expect(cards[1].title).toBe('In Queue / Requested');
    expect(cards[1].value).toContain('3 In Queue');
    expect(cards[1].subtitle).toBe('Awaiting your acceptance');
    expect(cards[1].badgeText).toBe('Action Needed');
    expect(cards[1].badgeColor).toContain('#ff9600');

    // Card 3: Completed (Month)
    expect(cards[2].title).toBe('Completed (Month)');
    expect(cards[2].value).toContain('18 Finished');
    expect(cards[2].subtitle).toBe('100% on-time delivery rate');
    expect(cards[2].badgeText).toBe('100% Success');
    expect(cards[2].badgeColor).toContain('#58cc02');

    // Card 4: Pending Approval
    expect(cards[3].title).toBe('Pending Approval');
    expect(cards[3].value).toContain('3 Drafts');
    expect(cards[3].subtitle).toBe('Safety Gate: 7/7 checks passed');
    expect(cards[3].badgeText).toBe('Human Control');
    expect(cards[3].badgeColor).toContain('#af71f5');
  });

  it('filters commissions correctly by tab (All, Active, In Queue, Delivered)', () => {
    const allComms = mockSummary.commissions;

    const allFiltered = filterCommissionsByTab(allComms, 'all');
    expect(allFiltered).toHaveLength(3);

    const activeFiltered = filterCommissionsByTab(allComms, 'active');
    expect(activeFiltered).toHaveLength(1);
    expect(activeFiltered[0].status).toBe('in_progress');

    const inQueueFiltered = filterCommissionsByTab(allComms, 'in_queue');
    expect(inQueueFiltered).toHaveLength(1);
    expect(inQueueFiltered[0].status).toBe('requested');

    const deliveredFiltered = filterCommissionsByTab(allComms, 'delivered');
    expect(deliveredFiltered).toHaveLength(1);
    expect(deliveredFiltered[0].status).toBe('delivered');

    const counts = computeTabCounts(allComms);
    expect(counts.all).toBe(3);
    expect(counts.active).toBe(1);
    expect(counts.in_queue).toBe(1);
    expect(counts.delivered).toBe(1);
  });

  it('formats Commission Card details with brief callout box and contextual actions', () => {
    const card = formatCommissionCard(mockSummary.commissions[0]);

    expect(card.serviceName).toBe('Live2D Character Model Full Rig');
    expect(card.formattedPrice).toBe('$850.00 USD');
    expect(card.clientUsername).toBe('@KitsuneMei');
    expect(card.orderId).toBe('#VG-8941');
    expect(card.briefSummary).toContain('Full commercial streaming rights included');
    expect(card.deadlineText).toContain('Guaranteed: Oct 28, 2026');
    expect(card.statusBadge.text).toBe('In Progress');
    expect(card.actions).toContain('Open Thread');
    expect(card.actions).toContain('Update Stage');
    expect(card.actions).toContain('Mark Completed');
  });

  it('evaluates Draft Requiring Approval context with 7-point gate and SHA-256 verification', () => {
    const draft = mockSummary.pendingDrafts[0];
    const ctx = getDraftApprovalContext(draft);

    expect(ctx.gateBadge).toBe('7/7 Gate Passed');
    expect(ctx.targetClient).toBe('Reply to @KitsuneMei');
    expect(ctx.sha256Indicator).toBe('SHA-256 Verified');
    expect(ctx.groundingIndicator).toBe('Grounded: Timezone UTC+9');
    expect(ctx.content).toContain('eye physics and blink physics');
  });

  it('formats relative timestamp accurately', () => {
    const now = Date.now();
    expect(formatRelativeTime(new Date(now - 8 * 60 * 1000))).toBe('8m ago');
    expect(formatRelativeTime(new Date(now - 45 * 60 * 1000))).toBe('45m ago');
    expect(formatRelativeTime(new Date(now - 3 * 3600 * 1000))).toBe('3h ago');
    expect(formatRelativeTime(new Date(now - 28 * 3600 * 1000))).toBe('1d ago');
  });

  it('provides client memory profile pills for FACT, PREFERENCE, and INFERENCE', () => {
    const profile = getClientMemoryProfile('KitsuneMei');

    expect(profile.facts.length).toBeGreaterThanOrEqual(1);
    expect(profile.preferences.length).toBeGreaterThanOrEqual(1);
    expect(profile.inferences.length).toBeGreaterThanOrEqual(1);

    expect(profile.facts[0].type).toBe('FACT');
    expect(profile.facts[0].badgeColor).toContain('#58cc02');

    expect(profile.preferences[0].type).toBe('PREFERENCE');
    expect(profile.preferences[0].badgeColor).toContain('#1cb0f6');

    expect(profile.inferences[0].type).toBe('INFERENCE');
    expect(profile.inferences[0].badgeColor).toContain('#af71f5');
  });

  it('verifies +page.svelte contains required UI elements and design tokens matching ui.pen', () => {
    const pagePath = resolve(__dirname, '../src/routes/dashboard/+page.svelte');
    const content = readFileSync(pagePath, 'utf8');

    // Header Row
    expect(content).toContain('Dashboard Overview');
    expect(content).toContain('Sync VGen');
    expect(content).toContain('Review Drafts');
    expect(content).toContain('#a5ed6e'); // Vibrant lime green CTA

    // Top Metric Cards
    expect(content).toContain('Active Commissions');
    expect(content).toContain('In Queue / Requested');
    expect(content).toContain('Completed (Month)');
    expect(content).toContain('Pending Approval');
    expect(content).toContain('#c7e8fa'); // 2px subtle sky-blue border

    // Left Column Pipeline & Tabs
    expect(content).toContain('Commission Pipeline');
    expect(content).toContain('Client Note & Brief Summary');
    expect(content).toContain('bg-[#f4faff]'); // Subtle surface callout

    // Right Column Safety Gate & Context
    expect(content).toContain('7/7 Gate Passed');
    expect(content).toContain('SHA-256 Verified');
    expect(content).toContain('Grounded: Timezone UTC+9');
    expect(content).toContain('Approve and Dispatch');

    // Inbound Messages & Memory Profile
    expect(content).toContain('Recent Inbound Messages');
    expect(content).toContain('Client Memory Profile');
    expect(content).toContain('FACT');
    expect(content).toContain('PREFERENCE');
    expect(content).toContain('INFERENCE');
  });
});
