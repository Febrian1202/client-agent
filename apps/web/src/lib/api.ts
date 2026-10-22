export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface UserProfile {
  id: number;
  name: string;
  email: string;
}

export interface HealthStatus {
  status: string;
  database: string;
  redis: string;
}

export interface CommissionItem {
  id: number;
  clientId: number;
  externalId?: string | null;
  serviceName: string;
  amount: string;
  currency: string;
  estimatedStart?: string | null;
  guaranteedDelivery?: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  clientUsername?: string;
  clientDisplayName?: string;
  clientAvatarUrl?: string;
}

export interface MessageItem {
  id: number;
  conversationId: number;
  externalId?: string | null;
  direction: 'inbound' | 'outbound' | string;
  senderType: 'client' | 'creator' | 'agent' | string;
  senderName: string;
  content: string;
  metadata?: Record<string, unknown> | null;
  sentAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  clientUsername?: string;
  clientDisplayName?: string;
  clientAvatarUrl?: string;
}

export interface ConversationSummary {
  id: number;
  clientId: number;
  platform: string;
  externalId: string;
  externalUrl?: string | null;
  status: string;
  lastSyncedAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  clientUsername?: string | null;
  clientDisplayName?: string | null;
  clientAvatarUrl?: string | null;
  lastMessageSnippet?: string | null;
  unreadCount?: number;
}

export interface DraftItem {
  id: number;
  conversationId: number;
  agentRunId?: number | null;
  content: string;
  status: string;
  approvedBy?: number | null;
  approvedAt?: string | Date | null;
  sentAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  clientUsername?: string | null;
}

export interface ApprovalItem {
  id: number;
  draftId: number;
  userId: number;
  action: string;
  status: string;
  contentHash?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface ClientItem {
  id: number;
  userId: number;
  platform: string;
  externalId?: string | null;
  username: string;
  displayName?: string | null;
  profileUrl?: string | null;
  avatarUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  firstSeenAt?: string | Date | null;
  lastSeenAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface ClientMemoryItem {
  id: number;
  clientId: number;
  type: 'fact' | 'preference' | 'inference' | string;
  category: 'technical' | 'scope' | 'assets' | 'general' | 'communication' | string;
  content: string;
  source: string;
  confidence: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface GroupedClientMemories {
  facts: ClientMemoryItem[];
  preferences: ClientMemoryItem[];
  inferences: ClientMemoryItem[];
}

export interface CreateClientMemoryInput {
  type: 'fact' | 'preference' | 'inference' | string;
  category: 'technical' | 'scope' | 'assets' | 'general' | 'communication' | string;
  content: string;
  source?: string;
  confidence?: string;
}

export interface TaskItem {
  id: number;
  userId: number;
  eventId?: number | null;
  type: string;
  status: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  attempts: number;
  maxAttempts: number;
  idempotencyKey?: string | null;
  error?: string | null;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface AuditItem {
  id: number;
  userId?: number | null;
  actorType: 'user' | 'agent' | 'system' | string;
  actorId?: number | null;
  action: string;
  targetType: string;
  targetId: number;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  createdAt: string | Date;
}

export interface IntegrationItem {
  provider: 'gmail' | 'discord' | string;
  status: string;
  connected: boolean;
  metadata: Record<string, unknown>;
}

export interface DashboardSummary {
  metrics: {
    activeCount: number;
    inQueueCount: number;
    completedMonthCount: number;
    pendingDraftCount: number;
  };
  commissions: CommissionItem[];
  activeCommissions: CommissionItem[];
  recentMessages: MessageItem[];
  pendingDrafts: DraftItem[];
}

export interface CommissionListParams {
  status?: string;
  clientId?: number;
  limit?: number;
  offset?: number;
}

export interface ConversationListParams {
  platform?: string;
  clientId?: number;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ConversationMessagesParams {
  limit?: number;
  order?: 'asc' | 'desc' | string;
}

export interface DraftListParams {
  status?: string;
  conversationId?: number;
  limit?: number;
  offset?: number;
}

export interface ClientListParams {
  search?: string;
  platform?: string;
  userId?: number;
  limit?: number;
  offset?: number;
}

export interface TaskListParams {
  page?: number;
  limit?: number;
  status?: string;
  type?: string;
}

export interface AuditLogListParams {
  actorType?: string;
  targetType?: string;
  userId?: number;
  limit?: number;
  offset?: number;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

function buildQueryString(params?: Record<string, unknown>): string {
  if (!params) return '';
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

export class ApiClient {
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(options?: ApiClientOptions) {
    this.baseUrl = options?.baseUrl ?? '';
    this.fetchFn = options?.fetch ?? globalThis.fetch;
  }

  private async request<T>(
    path: string,
    options?: {
      method?: string;
      body?: unknown;
      params?: Record<string, unknown>;
    }
  ): Promise<T> {
    const qs = buildQueryString(options?.params);
    const url = `${this.baseUrl}${path}${qs}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await this.fetchFn(url, {
      method: options?.method ?? 'GET',
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: 'include',
    });

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const code = data?.error?.code;
      const message = data?.error?.message || `Request to ${path} failed with status ${res.status}`;
      throw new ApiError(message, res.status, code, data?.error?.details);
    }

    return data as T;
  }

  async getHealth(): Promise<HealthStatus> {
    const res = await this.fetchFn(`${this.baseUrl}/health/ready`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Health check returned status ${res.status}`);
    }

    return res.json() as Promise<HealthStatus>;
  }

  async login(username: string, password: string): Promise<UserProfile> {
    const res = await this.fetchFn(`${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
    });

    let data: { user?: UserProfile; error?: { message?: string } } | null = null;
    try {
      data = (await res.json()) as { user?: UserProfile; error?: { message?: string } };
    } catch {
      data = null;
    }

    if (!res.ok) {
      const message = data?.error?.message || `Login failed with status ${res.status}`;
      throw new Error(message);
    }

    if (!data?.user) {
      throw new Error('Malformed login response: user data missing');
    }

    return data.user;
  }

  async getMe(): Promise<UserProfile | null> {
    const res = await this.fetchFn(`${this.baseUrl}/api/v1/auth/me`, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });

    if (res.status === 401 || !res.ok) {
      return null;
    }

    try {
      const data = (await res.json()) as { user?: UserProfile };
      return data?.user || null;
    } catch {
      return null;
    }
  }

  async logout(): Promise<void> {
    await this.fetchFn(`${this.baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    return this.request<DashboardSummary>('/api/v1/dashboard/summary');
  }

  async listCommissions(params?: CommissionListParams): Promise<CommissionItem[]> {
    const res = await this.request<{ commissions?: CommissionItem[]; data?: CommissionItem[] }>(
      '/api/v1/commissions',
      { params: params as Record<string, unknown> }
    );
    return res.commissions ?? res.data ?? [];
  }

  async getCommission(id: number): Promise<CommissionItem> {
    const res = await this.request<{ commission: CommissionItem }>(`/api/v1/commissions/${id}`);
    return res.commission;
  }

  async updateCommission(id: number, data: Partial<CommissionItem>): Promise<CommissionItem> {
    const res = await this.request<{ commission: CommissionItem }>(`/api/v1/commissions/${id}`, {
      method: 'PATCH',
      body: data,
    });
    return res.commission;
  }

  async listConversations(params?: ConversationListParams): Promise<ConversationSummary[]> {
    const res = await this.request<{
      conversations?: ConversationSummary[];
      data?: ConversationSummary[];
    }>('/api/v1/conversations', { params: params as Record<string, unknown> });
    return res.conversations ?? res.data ?? [];
  }

  async getConversation(
    id: number
  ): Promise<{ conversation: ConversationSummary; client?: ClientItem | null }> {
    return this.request<{ conversation: ConversationSummary; client?: ClientItem | null }>(
      `/api/v1/conversations/${id}`
    );
  }

  async getConversationMessages(
    id: number,
    params?: ConversationMessagesParams
  ): Promise<MessageItem[]> {
    const res = await this.request<{ messages?: MessageItem[]; data?: MessageItem[] }>(
      `/api/v1/conversations/${id}/messages`,
      { params: params as Record<string, unknown> }
    );
    return res.messages ?? res.data ?? [];
  }

  async syncConversation(
    idOrUsername: number | string
  ): Promise<{ taskId: string | number; status: string }> {
    if (typeof idOrUsername === 'number') {
      return this.request<{ taskId: string | number; status: string }>(
        `/api/v1/conversations/${idOrUsername}/sync`,
        { method: 'POST' }
      );
    }
    return this.request<{ taskId: string | number; status: string }>(
      '/api/v1/conversations/sync',
      { method: 'POST', body: { username: idOrUsername } }
    );
  }

  async listDrafts(params?: DraftListParams): Promise<DraftItem[]> {
    const res = await this.request<{ drafts?: DraftItem[] }>('/api/v1/drafts', {
      params: params as Record<string, unknown>,
    });
    return res.drafts ?? [];
  }

  async getDraft(id: number): Promise<{
    draft: DraftItem;
    conversation?: ConversationSummary | null;
    approvals?: ApprovalItem[];
  }> {
    return this.request<{
      draft: DraftItem;
      conversation?: ConversationSummary | null;
      approvals?: ApprovalItem[];
    }>(`/api/v1/drafts/${id}`);
  }

  async createDraft(data: { conversationId: number; content: string }): Promise<DraftItem> {
    const res = await this.request<{ draft: DraftItem }>('/api/v1/drafts', {
      method: 'POST',
      body: data,
    });
    return res.draft;
  }

  async updateDraft(id: number, content: string): Promise<DraftItem> {
    const res = await this.request<{ draft: DraftItem }>(`/api/v1/drafts/${id}`, {
      method: 'PATCH',
      body: { content },
    });
    return res.draft;
  }

  async approveDraft(id: number): Promise<DraftItem> {
    const res = await this.request<{ draft: DraftItem }>(`/api/v1/drafts/${id}/approve`, {
      method: 'POST',
    });
    return res.draft;
  }

  async rejectDraft(id: number, reason?: string): Promise<DraftItem> {
    const res = await this.request<{ draft: DraftItem }>(`/api/v1/drafts/${id}/reject`, {
      method: 'POST',
      body: reason !== undefined ? { reason } : undefined,
    });
    return res.draft;
  }

  async sendDraft(id: number): Promise<{ taskId: number | string; status: string }> {
    return this.request<{ taskId: number | string; status: string }>(`/api/v1/drafts/${id}/send`, {
      method: 'POST',
    });
  }

  async listClients(params?: ClientListParams): Promise<ClientItem[]> {
    const res = await this.request<{ clients?: ClientItem[]; data?: ClientItem[] }>(
      '/api/v1/clients',
      { params: params as Record<string, unknown> }
    );
    return res.clients ?? res.data ?? [];
  }

  async getClient(id: number): Promise<ClientItem> {
    const res = await this.request<{ client: ClientItem }>(`/api/v1/clients/${id}`);
    return res.client;
  }

  async listClientMemories(
    clientId: number
  ): Promise<{ memories: ClientMemoryItem[]; grouped: GroupedClientMemories }> {
    return this.request<{ memories: ClientMemoryItem[]; grouped: GroupedClientMemories }>(
      `/api/v1/clients/${clientId}/memories`
    );
  }

  async createClientMemory(
    clientId: number,
    input: CreateClientMemoryInput
  ): Promise<ClientMemoryItem> {
    const res = await this.request<{ memory: ClientMemoryItem }>(
      `/api/v1/clients/${clientId}/memories`,
      {
        method: 'POST',
        body: input,
      }
    );
    return res.memory;
  }

  async updateClientMemory(
    clientId: number,
    memoryId: number,
    data: string | { content?: string; type?: string; category?: string }
  ): Promise<ClientMemoryItem> {
    const body = typeof data === 'string' ? { content: data } : data;
    const res = await this.request<{ memory: ClientMemoryItem }>(
      `/api/v1/clients/${clientId}/memories/${memoryId}`,
      {
        method: 'PATCH',
        body,
      }
    );
    return res.memory;
  }

  async deleteClientMemory(
    clientId: number,
    memoryId: number
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/api/v1/clients/${clientId}/memories/${memoryId}`,
      {
        method: 'DELETE',
      }
    );
  }

  async listTasks(
    params?: TaskListParams
  ): Promise<{ tasks: TaskItem[]; pagination: { page: number; limit: number; total: number } }> {
    return this.request<{
      tasks: TaskItem[];
      pagination: { page: number; limit: number; total: number };
    }>('/api/v1/agent/tasks', { params: params as Record<string, unknown> });
  }

  async retryTask(id: number | string): Promise<{ task: TaskItem; status: string }> {
    return this.request<{ task: TaskItem; status: string }>(`/api/v1/agent/tasks/${id}/retry`, {
      method: 'POST',
    });
  }

  async listIntegrations(): Promise<IntegrationItem[]> {
    const res = await this.request<{ data: IntegrationItem[] }>('/api/v1/integrations');
    return res.data ?? [];
  }

  async listAuditLogs(params?: AuditLogListParams): Promise<AuditItem[]> {
    const res = await this.request<{ auditLogs?: AuditItem[]; data?: AuditItem[] }>(
      '/api/v1/audit-log',
      { params: params as Record<string, unknown> }
    );
    return res.auditLogs ?? res.data ?? [];
  }
}

export const api = new ApiClient();
