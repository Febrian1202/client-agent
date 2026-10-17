export class SessionExpiredError extends Error {
  constructor(message = 'VGen session has expired — manual re-login required') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class ClientNotFoundError extends Error {
  constructor(username: string) {
    super(`VGen client not found: ${username}`);
    this.name = 'ClientNotFoundError';
  }
}

export class NavigationTimeoutError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NavigationTimeoutError';
  }
}

export class NotSupportedError extends Error {
  constructor(method: string) {
    super(`not implemented until a later phase: ${method}`);
    this.name = 'NotSupportedError';
  }
}
