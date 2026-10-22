import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly supabaseClient: SupabaseClient | null;
  private readonly supabaseServerClient: SupabaseClient | null;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('SUPABASE_URL');
    const serverKey =
      this.config.get<string>('SUPABASE_SECRET_KEY') ||
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    const key =
      serverKey || this.config.get<string>('SUPABASE_PUBLISHABLE_KEY');

    this.supabaseClient =
      url && key
        ? createClient(url, key, {
            auth: {
              autoRefreshToken: false,
              persistSession: false,
            },
          })
        : null;
    this.supabaseServerClient =
      url && serverKey
        ? createClient(url, serverKey, {
            auth: {
              autoRefreshToken: false,
              persistSession: false,
            },
          })
        : null;
  }

  get isConfigured(): boolean {
    return this.supabaseClient !== null;
  }

  get client(): SupabaseClient {
    if (!this.supabaseClient) {
      throw new ServiceUnavailableException(
        'Supabase client is not configured. Set SUPABASE_URL and a Supabase server key.',
      );
    }

    return this.supabaseClient;
  }

  get isServerConfigured(): boolean {
    return this.supabaseServerClient !== null;
  }

  get serverClient(): SupabaseClient {
    if (!this.supabaseServerClient) {
      throw new ServiceUnavailableException(
        'Supabase server client is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.',
      );
    }

    return this.supabaseServerClient;
  }
}
