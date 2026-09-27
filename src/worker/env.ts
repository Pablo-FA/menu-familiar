export interface Bindings {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Solo para desarrollo local (.dev.vars). Ver isLocalBypass. */
  DEV_DISABLE_ACCESS?: string;
}

export interface Variables {
  userEmail: string | null;
  accessMode: "enforced" | "disabled-local";
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: Variables;
}
