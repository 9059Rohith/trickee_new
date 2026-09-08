export type StoredAuthSession = {
  accessToken: string;
  refreshToken?: string | null;
};

export type RecoveredAuthSession<TUser> = {
  accessToken: string;
  refreshToken?: string | null;
  user: TUser;
};

type RefreshResponse<TUser> = {
  access_token: string;
  refresh_token: string;
  user: TUser;
};

type SessionDependencies<TUser> = {
  load: () => Promise<StoredAuthSession | null>;
  verify: (accessToken: string) => Promise<TUser>;
  refresh: (refreshToken: string) => Promise<RefreshResponse<TUser>>;
  save: (session: StoredAuthSession) => Promise<void>;
  clear: () => Promise<void>;
};

const isAuthFailure = (error: unknown): boolean =>
  Boolean((error as { isAuth?: boolean } | null)?.isAuth);

/** Serializes refresh-token rotation so concurrent 401s cannot trigger replay revocation. */
export class SessionRestorer<TUser = any> {
  private inFlight: Promise<RecoveredAuthSession<TUser> | null> | null = null;

  constructor(private readonly dependencies: SessionDependencies<TUser>) {}

  recover(): Promise<RecoveredAuthSession<TUser> | null> {
    if (this.inFlight) return this.inFlight;
    const operation = this.performRecovery().finally(() => {
      if (this.inFlight === operation) this.inFlight = null;
    });
    this.inFlight = operation;
    return operation;
  }

  private async performRecovery(): Promise<RecoveredAuthSession<TUser> | null> {
    const saved = await this.dependencies.load();
    if (!saved?.accessToken) return null;
    try {
      const user = await this.dependencies.verify(saved.accessToken);
      return { ...saved, user };
    } catch (error) {
      if (!isAuthFailure(error)) return null;
      if (!saved.refreshToken) {
        await this.dependencies.clear();
        return null;
      }
    }

    try {
      const refreshed = await this.dependencies.refresh(saved.refreshToken!);
      const next = {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
      };
      await this.dependencies.save(next);
      return { ...next, user: refreshed.user };
    } catch (error) {
      if (isAuthFailure(error)) await this.dependencies.clear();
      return null;
    }
  }
}

export async function runWithSessionRecovery<T>(
  accessToken: string,
  recover: () => Promise<string | null>,
  operation: (token: string) => Promise<T>
): Promise<T> {
  try {
    return await operation(accessToken);
  } catch (error) {
    if (!isAuthFailure(error)) throw error;
    const recoveredToken = await recover();
    if (!recoveredToken) throw error;
    return operation(recoveredToken);
  }
}
