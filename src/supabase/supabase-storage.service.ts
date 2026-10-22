import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join, normalize, sep } from 'path';
import { SupabaseService } from './supabase.service';

const SUPABASE_REFERENCE_PREFIX = 'supabase://';

@Injectable()
export class SupabaseStorageService {
  private readonly bucket: string | null;
  private readonly signedUrlTtlSeconds: number;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {
    this.bucket = this.config.get<string>('SUPABASE_STORAGE_BUCKET') || null;
    const ttl = Number(
      this.config.get<string>('SUPABASE_SIGNED_URL_TTL_SECONDS') ?? 300,
    );
    this.signedUrlTtlSeconds = Number.isInteger(ttl) && ttl > 0 ? ttl : 300;
  }

  get usesSupabase(): boolean {
    return Boolean(this.bucket);
  }

  getStatus() {
    const remote = this.usesSupabase;
    return {
      healthy: !remote || this.supabase.isServerConfigured,
      provider: remote ? ('supabase' as const) : ('local' as const),
      bucket: this.bucket,
      signedUrlTtlSeconds: remote ? this.signedUrlTtlSeconds : null,
    };
  }

  async upload(
    objectPath: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const safePath = this.normalizeObjectPath(objectPath);
    if (!this.bucket) return this.writeLocally(safePath, buffer);
    if (!this.supabase.isServerConfigured) {
      throw new ServiceUnavailableException(
        'SUPABASE_STORAGE_BUCKET is set, but no Supabase server key is configured.',
      );
    }

    const { error } = await this.supabase.serverClient.storage
      .from(this.bucket)
      .upload(safePath, buffer, { contentType, upsert: false });
    if (error) {
      throw new ServiceUnavailableException(
        `Supabase Storage upload failed: ${error.message}`,
      );
    }
    return `${SUPABASE_REFERENCE_PREFIX}${this.bucket}/${safePath}`;
  }

  async createSignedUploadUrl(objectPath: string) {
    const safePath = this.normalizeObjectPath(objectPath);
    if (!this.bucket || !this.supabase.isServerConfigured) {
      throw new ServiceUnavailableException(
        'Direct upload requires SUPABASE_STORAGE_BUCKET and a Supabase server key.',
      );
    }
    const { data, error } = await this.supabase.serverClient.storage
      .from(this.bucket)
      .createSignedUploadUrl(safePath, { upsert: false });
    if (error) {
      throw new ServiceUnavailableException(
        `Supabase Storage signed upload URL failed: ${error.message}`,
      );
    }
    return {
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path,
      reference: `${SUPABASE_REFERENCE_PREFIX}${this.bucket}/${data.path}`,
    };
  }

  assertReferenceWithin(reference: string, objectPathPrefix: string): void {
    const remote = this.parseSupabaseReference(reference);
    const safePrefix = `${this.normalizeObjectPath(objectPathPrefix).replace(/\/+$/, '')}/`;
    if (
      !remote ||
      remote.bucket !== this.bucket ||
      !remote.path.startsWith(safePrefix)
    ) {
      throw new ServiceUnavailableException('Invalid storage reference scope.');
    }
  }

  async download(reference: string): Promise<Buffer> {
    const remote = this.parseSupabaseReference(reference);
    if (!remote) return readFile(this.localPath(reference));

    const { data, error } = await this.supabase.serverClient.storage
      .from(remote.bucket)
      .download(remote.path);
    if (error) {
      throw new ServiceUnavailableException(
        `Supabase Storage download failed: ${error.message}`,
      );
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async createSignedUrl(reference: string, downloadName?: string) {
    const remote = this.parseSupabaseReference(reference);
    if (!remote) {
      return {
        url: reference,
        expiresIn: null,
        storage: 'local' as const,
      };
    }

    const { data, error } = await this.supabase.serverClient.storage
      .from(remote.bucket)
      .createSignedUrl(remote.path, this.signedUrlTtlSeconds, {
        download: downloadName || false,
      });
    if (error) {
      throw new ServiceUnavailableException(
        `Supabase Storage signed URL failed: ${error.message}`,
      );
    }
    return {
      url: data.signedUrl,
      expiresIn: this.signedUrlTtlSeconds,
      storage: 'supabase' as const,
    };
  }

  async remove(references: Array<string | null | undefined>): Promise<void> {
    const remoteByBucket = new Map<string, string[]>();
    for (const reference of references.filter(Boolean) as string[]) {
      const remote = this.parseSupabaseReference(reference);
      if (remote) {
        const paths = remoteByBucket.get(remote.bucket) ?? [];
        paths.push(remote.path);
        remoteByBucket.set(remote.bucket, paths);
        continue;
      }
      try {
        await unlink(this.localPath(reference));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }

    for (const [bucket, paths] of remoteByBucket) {
      const { error } = await this.supabase.serverClient.storage
        .from(bucket)
        .remove(paths);
      if (error) {
        throw new ServiceUnavailableException(
          `Supabase Storage delete failed: ${error.message}`,
        );
      }
    }
  }

  private async writeLocally(objectPath: string, buffer: Buffer) {
    const absolutePath = join(process.cwd(), 'uploads', objectPath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
    return `/uploads/${objectPath.replace(/\\/g, '/')}`;
  }

  private localPath(reference: string): string {
    const relative = reference.replace(/^\/+/, '').replace(/^uploads\//, '');
    const absolute = normalize(join(process.cwd(), 'uploads', relative));
    const root = normalize(join(process.cwd(), 'uploads')) + sep;
    if (!absolute.startsWith(root)) {
      throw new ServiceUnavailableException('Invalid local storage path.');
    }
    return absolute;
  }

  private normalizeObjectPath(objectPath: string): string {
    const normalized = objectPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.split('/').some((part) => part === '..')) {
      throw new ServiceUnavailableException('Invalid storage object path.');
    }
    return normalized;
  }

  private parseSupabaseReference(reference: string) {
    if (!reference.startsWith(SUPABASE_REFERENCE_PREFIX)) return null;
    const value = reference.slice(SUPABASE_REFERENCE_PREFIX.length);
    const separator = value.indexOf('/');
    if (separator <= 0 || separator === value.length - 1) {
      throw new ServiceUnavailableException(
        'Invalid Supabase storage reference.',
      );
    }
    return {
      bucket: value.slice(0, separator),
      path: this.normalizeObjectPath(value.slice(separator + 1)),
    };
  }
}
