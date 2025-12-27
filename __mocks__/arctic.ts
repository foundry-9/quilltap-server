/**
 * Mock for arctic OAuth library
 * Used in tests to avoid ESM module loading issues
 */

export const generateState = jest.fn(() => 'mock-state-token');
export const generateCodeVerifier = jest.fn(() => 'mock-code-verifier');

// Mock OAuth2Tokens interface
export class OAuth2Tokens {
  private _accessToken: string;
  private _refreshToken: string | null;
  private _expiresAt: Date | null;
  private _idToken: string | null;

  constructor(data: {
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresAt?: Date;
    idToken?: string;
  }) {
    this._accessToken = data.accessToken;
    this._refreshToken = data.refreshToken || null;
    this._expiresAt = data.accessTokenExpiresAt || null;
    this._idToken = data.idToken || null;
  }

  accessToken(): string {
    return this._accessToken;
  }

  hasRefreshToken(): boolean {
    return this._refreshToken !== null;
  }

  refreshToken(): string {
    if (!this._refreshToken) {
      throw new Error('No refresh token');
    }
    return this._refreshToken;
  }

  accessTokenExpiresAt(): Date | undefined {
    return this._expiresAt || undefined;
  }

  idToken(): string {
    if (!this._idToken) {
      throw new Error('No ID token');
    }
    return this._idToken;
  }
}

// Mock Google provider
export class Google {
  constructor(
    _clientId: string,
    _clientSecret: string,
    _redirectUri: string
  ) {}

  createAuthorizationURL(
    _state: string,
    _codeVerifier: string,
    _scopes: string[]
  ): URL {
    return new URL('https://accounts.google.com/o/oauth2/v2/auth');
  }

  async validateAuthorizationCode(
    _code: string,
    _codeVerifier: string
  ): Promise<OAuth2Tokens> {
    return new OAuth2Tokens({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      idToken: 'mock-id-token',
    });
  }
}

// Add other provider mocks as needed
export class GitHub {
  constructor(_clientId: string, _clientSecret: string, _redirectUri: string) {}

  createAuthorizationURL(
    _state: string,
    _codeVerifier: string,
    _scopes: string[]
  ): URL {
    return new URL('https://github.com/login/oauth/authorize');
  }

  async validateAuthorizationCode(
    _code: string,
    _codeVerifier: string
  ): Promise<OAuth2Tokens> {
    return new OAuth2Tokens({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    });
  }
}

export class Discord {
  constructor(_clientId: string, _clientSecret: string, _redirectUri: string) {}

  createAuthorizationURL(
    _state: string,
    _codeVerifier: string,
    _scopes: string[]
  ): URL {
    return new URL('https://discord.com/oauth2/authorize');
  }

  async validateAuthorizationCode(
    _code: string,
    _codeVerifier: string
  ): Promise<OAuth2Tokens> {
    return new OAuth2Tokens({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    });
  }
}
