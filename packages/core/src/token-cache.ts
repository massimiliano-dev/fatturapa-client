import { FatturaPAError } from './errors.js';

/** A token and its absolute expiry. */
export interface CachedToken {
  value: string;
  expiresAt: Date;
  /** Optional refresh token, passed back to `refresh`. */
  refreshToken?: string;
  /** Absolute expiry of the refresh token, if known. */
  refreshExpiresAt?: Date;
}

export interface TokenCacheOptions {
  /** Obtains a new token with the long-lived credentials (login). */
  login: () => Promise<CachedToken>;
  /** Obtains a new token from a refresh token. Optional. */
  refresh?: (refreshToken: string) => Promise<CachedToken>;
  /** Renew this many seconds before expiry. Default 60. */
  marginSeconds?: number;
  /** Clock, for tests. */
  now?: () => number;
}

/**
 * Caches a short-lived access token and renews it before it expires, with a single in-flight renewal
 * shared by concurrent callers (some providers allow very few logins: Aruba, one per minute per IP).
 * Refresh is tried first when available; login is the fallback. Tokens never appear in errors.
 */
export class TokenCache {
  #token: CachedToken | undefined;
  #pending: Promise<CachedToken> | undefined;
  readonly #options: Required<Pick<TokenCacheOptions, 'marginSeconds' | 'now'>> & TokenCacheOptions;

  constructor(options: TokenCacheOptions) {
    this.#options = { marginSeconds: 60, now: Date.now, ...options };
  }

  /** Returns a valid token, renewing it if needed. */
  async get(): Promise<string> {
    const now = this.#options.now();
    const token = this.#token;
    if (token && token.expiresAt.getTime() - this.#options.marginSeconds * 1000 > now) return token.value;
    this.#pending ??= this.#renew(token, now).finally(() => {
      this.#pending = undefined;
    });
    const renewed = await this.#pending;
    return renewed.value;
  }

  async #renew(previous: CachedToken | undefined, now: number): Promise<CachedToken> {
    let next: CachedToken | undefined;
    const canRefresh =
      this.#options.refresh !== undefined &&
      previous?.refreshToken !== undefined &&
      (previous.refreshExpiresAt === undefined || previous.refreshExpiresAt.getTime() - 5000 > now);
    if (canRefresh) {
      next = await this.#options.refresh!(previous!.refreshToken!).catch(() => undefined);
    }
    next ??= await this.#options.login();
    if (!next.value || /[\r\n]/.test(next.value))
      throw new FatturaPAError('The provider returned an invalid token');
    this.#token = next;
    return next;
  }

  /**
   * Marks the token as expired after a 401, so that the next `get` renews it (with the refresh token when
   * there is one). Pass the token value that was rejected: if another caller has renewed it meanwhile, the
   * fresh token is kept, so concurrent 401s cause one renewal, not one per request.
   */
  invalidate(rejected?: string): void {
    const token = this.#token;
    if (!token) return;
    if (rejected !== undefined && token.value !== rejected) return;
    this.#token = { ...token, expiresAt: new Date(0) };
  }
}
