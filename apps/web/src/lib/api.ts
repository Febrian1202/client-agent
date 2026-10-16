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

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class ApiClient {
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(options?: ApiClientOptions) {
    this.baseUrl = options?.baseUrl ?? '';
    this.fetchFn = options?.fetch ?? globalThis.fetch;
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
}

export const api = new ApiClient();
