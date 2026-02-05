type SupabaseConfig = {
  url: string;
  anonKey: string;
};

type AppConfig = {
  nodeEnv: string;
  port: number;
  appBaseUrl?: string;
};

let supabaseConfig: SupabaseConfig | null = null;
let appConfig: AppConfig | null = null;

const requireEnv = (value: string | undefined, name: string) => {
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
};

export const getSupabaseConfig = (): SupabaseConfig => {
  if (supabaseConfig) {
    return supabaseConfig;
  }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  supabaseConfig = {
    url: requireEnv(url, 'SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: requireEnv(anonKey, 'SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  };

  return supabaseConfig;
};

export const getAppConfig = (): AppConfig => {
  if (appConfig) {
    return appConfig;
  }
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  appConfig = {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port,
    appBaseUrl: process.env.APP_BASE_URL
  };
  return appConfig;
};
