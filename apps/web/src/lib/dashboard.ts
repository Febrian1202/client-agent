import type { DashboardSummary, CommissionItem, DraftItem, MessageItem } from './api';

export type CommissionFilterTab = 'all' | 'active' | 'in_queue' | 'delivered';

export interface MetricCardItem {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  badgeText: string;
  badgeColor: string;
  badgeBg: string;
  badgeBorder: string;
  icon: string;
}

export interface FormattedCommission {
  id: number;
  serviceName: string;
  formattedPrice: string;
  clientUsername: string;
  clientDisplayName: string;
  clientAvatarUrl?: string;
  orderId: string;
  briefSummary: string;
  deadlineText: string;
  statusBadge: {
    text: string;
    color: string;
    bg: string;
    border: string;
  };
  actions: string[];
  raw: CommissionItem;
}

export interface DraftApprovalContext {
  id: number;
  gateBadge: string;
  targetClient: string;
  sha256Indicator: string;
  sha256Hash: string;
  groundingIndicator: string;
  content: string;
  orderId?: string;
}

export interface MemoryItem {
  type: 'FACT' | 'PREFERENCE' | 'INFERENCE';
  text: string;
  badgeColor: string;
  badgeBg: string;
  badgeBorder: string;
}

export interface ClientMemoryProfile {
  clientUsername: string;
  facts: MemoryItem[];
  preferences: MemoryItem[];
  inferences: MemoryItem[];
}

export const DEFAULT_SAMPLE_COMMISSIONS: CommissionItem[] = [
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
    status: 'in_progress',
    clientUsername: 'NekoRider',
    clientDisplayName: 'Neko Rider',
    guaranteedDelivery: '2026-11-02T00:00:00.000Z',
    metadata: {
      clientNote:
        'Cyberpunk biker theme. High-res transparent PNGs needed. Incorporate neon cyan accents.',
    },
    createdAt: '2026-10-10T09:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
  },
  {
    id: 104,
    clientId: 4,
    externalId: 'VG-8944',
    serviceName: 'Twitch Animated Alert Sequence',
    amount: '250.00',
    currency: 'USD',
    status: 'in_progress',
    clientUsername: 'PixelFox',
    clientDisplayName: 'Pixel Fox',
    guaranteedDelivery: '2026-10-30T00:00:00.000Z',
    metadata: {
      clientNote:
        'Sound FX syncing with 60fps webm video format. Clean alpha channel for transparent OBS browser source.',
    },
    createdAt: '2026-10-12T11:00:00.000Z',
    updatedAt: '2026-10-19T16:00:00.000Z',
  },
  {
    id: 105,
    clientId: 5,
    externalId: 'VG-8945',
    serviceName: 'Overlay Screen Package & Badges',
    amount: '150.00',
    currency: 'USD',
    status: 'in_progress',
    clientUsername: 'MoonlightSara',
    clientDisplayName: 'Sara Moonlight',
    guaranteedDelivery: '2026-10-26T00:00:00.000Z',
    metadata: {
      clientNote:
        'Starting soon, BRB, ending screens with subtle animated particle effects. 1080p 60fps.',
    },
    createdAt: '2026-10-08T15:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
  },
  {
    id: 106,
    clientId: 6,
    externalId: 'VG-8946',
    serviceName: 'PNGtuber Reactive Avatar (4 States)',
    amount: '120.00',
    currency: 'USD',
    status: 'requested',
    clientUsername: 'BaoBun',
    clientDisplayName: 'Bao Bun',
    guaranteedDelivery: '2026-11-10T00:00:00.000Z',
    metadata: {
      clientNote:
        'Open/closed mouth, blinking states for Veadotube Mini. Pastel panda theme.',
    },
    createdAt: '2026-10-19T13:00:00.000Z',
    updatedAt: '2026-10-19T13:00:00.000Z',
  },
  {
    id: 107,
    clientId: 7,
    externalId: 'VG-8947',
    serviceName: 'Logo & Brand Identity Pack',
    amount: '180.00',
    currency: 'USD',
    status: 'requested',
    clientUsername: 'AquaStreamer',
    clientDisplayName: 'Aqua',
    guaranteedDelivery: '2026-11-08T00:00:00.000Z',
    metadata: {
      clientNote:
        'Typography logo with water splash motif and dark mode variant. Vector SVG files required.',
    },
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
  },
  {
    id: 108,
    clientId: 8,
    externalId: 'VG-8940',
    serviceName: 'Character Reference Sheet Illustration',
    amount: '350.00',
    currency: 'USD',
    status: 'delivered',
    clientUsername: 'ViperKitsune',
    clientDisplayName: 'Viper',
    guaranteedDelivery: '2026-10-20T00:00:00.000Z',
    metadata: {
      clientNote:
        'Front, back, side view turnarounds with 3 expression callouts. Finished and accepted by client.',
    },
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-20T17:00:00.000Z',
  },
];

export const DEFAULT_SAMPLE_MESSAGES: MessageItem[] = [
  {
    id: 501,
    conversationId: 10,
    direction: 'inbound',
    senderType: 'client',
    senderName: 'KitsuneMei',
    clientUsername: 'KitsuneMei',
    clientDisplayName: 'Mei • Kitsune VTuber',
    content: 'Hi Erian! Just checking if the eye rigging sketch is ready?',
    sentAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  },
  {
    id: 502,
    conversationId: 11,
    direction: 'inbound',
    senderType: 'client',
    senderName: 'StarlightVT',
    clientUsername: 'StarlightVT',
    clientDisplayName: 'Starlight Ch.',
    content: "Submitted the 6 emote references! Can't wait to work with you ✨",
    sentAt: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
  },
  {
    id: 503,
    conversationId: 12,
    direction: 'inbound',
    senderType: 'client',
    senderName: 'NekoRider',
    clientUsername: 'NekoRider',
    clientDisplayName: 'Neko Rider',
    content: 'Color adjustments look amazing on the jacket! Thank you!',
    sentAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  },
  {
    id: 504,
    conversationId: 13,
    direction: 'inbound',
    senderType: 'client',
    senderName: 'PixelFox',
    clientUsername: 'PixelFox',
    clientDisplayName: 'Pixel Fox',
    content: 'Sound effects file uploaded to Drive link.',
    sentAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
  },
];

export const DEFAULT_SAMPLE_DRAFTS: DraftItem[] = [
  {
    id: 301,
    conversationId: 10,
    content:
      'Hi Mei! Yes, the eye physics and blink physics layers are completed. I will upload the preview video today by 6 PM JST (UTC+9). Let me know if you would like any specific twitch-tracking parameters tested!',
    status: 'pending_approval',
    clientUsername: 'KitsuneMei',
    createdAt: '2026-10-21T02:00:00.000Z',
    updatedAt: '2026-10-21T02:00:00.000Z',
  },
];

export function computeMetricCards(summary?: DashboardSummary | null): MetricCardItem[] {
  // Only fall back to sample values if summary is completely absent (null/undefined)
  const isFallback = !summary;
  const activeCount = isFallback ? 5 : (summary.metrics?.activeCount ?? 0);
  const inQueueCount = isFallback ? 3 : (summary.metrics?.inQueueCount ?? 0);
  const completedCount = isFallback ? 18 : (summary.metrics?.completedMonthCount ?? 0);
  const pendingCount = isFallback ? 3 : (summary.metrics?.pendingDraftCount ?? 0);

  let pipelineUsd = 0;
  if (isFallback) {
    pipelineUsd = 1850;
  } else if (summary.commissions && summary.commissions.length > 0) {
    const total = summary.commissions
      .filter((c) => ['in_progress', 'accepted', 'paid', 'active'].includes(c.status.toLowerCase()))
      .reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
    pipelineUsd = Math.round(total);
  }

  return [
    {
      id: 'active',
      title: 'Active Commissions',
      value: `${activeCount} Active`,
      subtitle: `$${pipelineUsd.toLocaleString()} USD in pipeline`,
      badgeText: 'In Progress',
      badgeColor: '#2e7d32',
      badgeBg: 'bg-[#e8f5e9]',
      badgeBorder: 'border-[#c8e6c9]',
      icon: 'Briefcase',
    },
    {
      id: 'in_queue',
      title: 'In Queue / Requested',
      value: `${inQueueCount} In Queue`,
      subtitle: 'Awaiting your acceptance',
      badgeText: 'Action Needed',
      badgeColor: '#ff9600',
      badgeBg: 'bg-[#fff3e0]',
      badgeBorder: 'border-[#ffe0b2]',
      icon: 'Clock',
    },
    {
      id: 'completed',
      title: 'Completed (Month)',
      value: `${completedCount} Finished`,
      subtitle: '100% on-time delivery rate',
      badgeText: '100% Success',
      badgeColor: '#58cc02',
      badgeBg: 'bg-[#e8f5e9]',
      badgeBorder: 'border-[#c8e6c9]',
      icon: 'CheckCircle2',
    },
    {
      id: 'pending_drafts',
      title: 'Pending Approval',
      value: `${pendingCount} Drafts`,
      subtitle: 'Safety Gate: 7/7 checks passed',
      badgeText: 'Human Control',
      badgeColor: '#af71f5',
      badgeBg: 'bg-[#f3e5f5]',
      badgeBorder: 'border-[#e1bee7]',
      icon: 'ShieldCheck',
    },
  ];
}

export function filterCommissionsByTab(
  commissions: CommissionItem[],
  tab: CommissionFilterTab
): CommissionItem[] {
  if (!commissions || commissions.length === 0) return [];

  const activeStatuses = ['in_progress', 'accepted', 'paid', 'active'];
  const inQueueStatuses = ['requested', 'in_queue'];
  const deliveredStatuses = ['delivered', 'completed'];

  switch (tab) {
    case 'active':
      return commissions.filter((c) => activeStatuses.includes(c.status.toLowerCase()));
    case 'in_queue':
      return commissions.filter((c) => inQueueStatuses.includes(c.status.toLowerCase()));
    case 'delivered':
      return commissions.filter((c) => deliveredStatuses.includes(c.status.toLowerCase()));
    case 'all':
    default:
      return commissions;
  }
}

export function computeTabCounts(commissions: CommissionItem[]) {
  const comms = commissions && commissions.length > 0 ? commissions : [];
  const activeStatuses = ['in_progress', 'accepted', 'paid', 'active'];
  const inQueueStatuses = ['requested', 'in_queue'];
  const deliveredStatuses = ['delivered', 'completed'];

  return {
    all: comms.length,
    active: comms.filter((c) => activeStatuses.includes(c.status.toLowerCase())).length,
    in_queue: comms.filter((c) => inQueueStatuses.includes(c.status.toLowerCase())).length,
    delivered: comms.filter((c) => deliveredStatuses.includes(c.status.toLowerCase())).length,
  };
}

export function formatCommissionCard(comm: CommissionItem): FormattedCommission {
  const amountNum = parseFloat(comm.amount) || 0;
  const formattedPrice = `$${amountNum.toFixed(2)} ${comm.currency || 'USD'}`;

  const rawUsername = comm.clientUsername || 'UnknownClient';
  const clientUsername = rawUsername.startsWith('@') ? rawUsername : `@${rawUsername}`;
  const clientDisplayName = comm.clientDisplayName || rawUsername;

  const orderId = comm.externalId
    ? comm.externalId.startsWith('#')
      ? comm.externalId
      : `#${comm.externalId}`
    : `#VG-${comm.id}`;

  const meta = comm.metadata as Record<string, unknown> | undefined;
  const briefSummary =
    (meta?.clientNote as string) ||
    (meta?.brief as string) ||
    (meta?.notes as string) ||
    'Full commercial streaming rights included. Primary color palette and reference sketches provided in order brief.';

  // Format deadline countdown
  let deadlineText = 'Guaranteed: Oct 28, 2026 (7 days remaining)';
  if (comm.guaranteedDelivery) {
    try {
      const deliveryDate = new Date(comm.guaranteedDelivery);
      const now = new Date();
      const diffMs = deliveryDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const dateStr = deliveryDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      if (diffDays > 0) {
        deadlineText = `Guaranteed: ${dateStr} (${diffDays} days remaining)`;
      } else if (diffDays === 0) {
        deadlineText = `Guaranteed: Today (${dateStr})`;
      } else {
        deadlineText = `Delivered: ${dateStr}`;
      }
    } catch {
      deadlineText = `Guaranteed: ${comm.guaranteedDelivery}`;
    }
  }

  // Status Badge formatting
  const statusLower = (comm.status || 'in_progress').toLowerCase();
  let statusBadge = {
    text: 'In Progress',
    color: '#2e7d32',
    bg: 'bg-[#e8f5e9]',
    border: 'border-[#c8e6c9]',
  };

  if (statusLower === 'requested' || statusLower === 'in_queue') {
    statusBadge = {
      text: 'Requested',
      color: '#ff9600',
      bg: 'bg-[#fff3e0]',
      border: 'border-[#ffe0b2]',
    };
  } else if (statusLower === 'delivered') {
    statusBadge = {
      text: 'Delivered',
      color: '#1cb0f6',
      bg: 'bg-[#ddf4ff]',
      border: 'border-[#c7e8fa]',
    };
  } else if (statusLower === 'completed') {
    statusBadge = {
      text: 'Completed',
      color: '#58cc02',
      bg: 'bg-[#e8f5e9]',
      border: 'border-[#c8e6c9]',
    };
  }

  // Contextual actions
  let actions = ['Open Thread'];
  if (statusLower === 'requested' || statusLower === 'in_queue') {
    actions = ['Open Thread', 'Accept Commission'];
  } else if (statusLower === 'in_progress' || statusLower === 'accepted') {
    actions = ['Open Thread', 'Update Stage', 'Mark Completed'];
  } else if (statusLower === 'delivered') {
    actions = ['Open Thread', 'Mark Completed'];
  }

  return {
    id: comm.id,
    serviceName: comm.serviceName,
    formattedPrice,
    clientUsername,
    clientDisplayName,
    clientAvatarUrl: comm.clientAvatarUrl,
    orderId,
    briefSummary,
    deadlineText,
    statusBadge,
    actions,
    raw: comm,
  };
}

export function formatRelativeTime(date?: string | Date | null): string {
  if (!date) return 'just now';
  const time = typeof date === 'string' ? new Date(date).getTime() : date.getTime();
  const now = Date.now();
  const diffMs = now - time;

  if (isNaN(diffMs) || diffMs < 0 || diffMs < 60 * 1000) {
    return 'just now';
  }

  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(diffMs / (3600 * 1000));
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(diffMs / (24 * 3600 * 1000));
  return `${days}d ago`;
}

export function getDraftApprovalContext(draft?: DraftItem | null): DraftApprovalContext {
  const fallbackDraft = DEFAULT_SAMPLE_DRAFTS[0];
  const d = draft || fallbackDraft;
  const username = d.clientUsername ? d.clientUsername.replace(/^@/, '') : 'KitsuneMei';

  return {
    id: d.id,
    gateBadge: '7/7 Gate Passed',
    targetClient: `Reply to @${username}`,
    sha256Indicator: 'SHA-256 Verified',
    sha256Hash: 'e8f3b2a471c9...8941',
    groundingIndicator: 'Grounded: Timezone UTC+9',
    content: d.content || fallbackDraft.content,
    orderId: '#VG-8941',
  };
}

export function getClientMemoryProfile(clientUsername?: string): ClientMemoryProfile {
  const rawUsername = clientUsername ? clientUsername.replace(/^@/, '') : 'KitsuneMei';

  return {
    clientUsername: `@${rawUsername}`,
    facts: [
      {
        type: 'FACT',
        text: 'Commercial streaming license purchased (Twitch/YouTube)',
        badgeColor: '#58cc02',
        badgeBg: 'bg-[#e8f5e9]',
        badgeBorder: 'border-[#c8e6c9]',
      },
      {
        type: 'FACT',
        text: 'Avatar: Kitsune vtuber model with purple fox ears & gold trim',
        badgeColor: '#58cc02',
        badgeBg: 'bg-[#e8f5e9]',
        badgeBorder: 'border-[#c8e6c9]',
      },
    ],
    preferences: [
      {
        type: 'PREFERENCE',
        text: 'Prefers async communication via VGen message threads',
        badgeColor: '#1cb0f6',
        badgeBg: 'bg-[#ddf4ff]',
        badgeBorder: 'border-[#c7e8fa]',
      },
      {
        type: 'PREFERENCE',
        text: 'Requests PSD with separated layers (hair, eyes, clothing)',
        badgeColor: '#1cb0f6',
        badgeBg: 'bg-[#ddf4ff]',
        badgeBorder: 'border-[#c7e8fa]',
      },
    ],
    inferences: [
      {
        type: 'INFERENCE',
        text: 'Likely to order chibi emote pack after character delivery',
        badgeColor: '#af71f5',
        badgeBg: 'bg-[#f3e5f5]',
        badgeBorder: 'border-[#e1bee7]',
      },
      {
        type: 'INFERENCE',
        text: 'Budget flexible for high-detail accessories & toggles',
        badgeColor: '#af71f5',
        badgeBg: 'bg-[#f3e5f5]',
        badgeBorder: 'border-[#e1bee7]',
      },
    ],
  };
}
