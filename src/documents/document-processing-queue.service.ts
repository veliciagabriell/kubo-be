import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Receiver } from '@upstash/qstash';

type DocumentProcessor = (documentId: string) => Promise<void>;

@Injectable()
export class DocumentProcessingQueueService {
  private readonly logger = new Logger(DocumentProcessingQueueService.name);
  private readonly qstash: Client | null;
  private readonly receiver: Receiver | null;
  private readonly callbackUrl: string | null;
  private processor: DocumentProcessor | null = null;

  constructor(private readonly config: ConfigService) {
    const token = this.config.get<string>('QSTASH_TOKEN');
    const currentSigningKey = this.config.get<string>(
      'QSTASH_CURRENT_SIGNING_KEY',
    );
    const nextSigningKey = this.config.get<string>('QSTASH_NEXT_SIGNING_KEY');
    const baseUrl = this.config.get<string>('QSTASH_URL');
    const apiBaseUrl = this.config
      .get<string>('API_BASE_URL')
      ?.replace(/\/+$/, '');

    this.qstash = token
      ? new Client({ token, ...(baseUrl ? { baseUrl } : {}) })
      : null;
    this.receiver =
      currentSigningKey && nextSigningKey
        ? new Receiver({ currentSigningKey, nextSigningKey })
        : null;
    this.callbackUrl = apiBaseUrl
      ? `${apiBaseUrl}/api/v1/internal/document-processing`
      : null;

    if (this.qstash && !this.callbackUrl) {
      this.logger.warn(
        'QSTASH_TOKEN tersedia tetapi API_BASE_URL belum diatur; development memakai fallback in-process.',
      );
    } else if (!this.qstash) {
      this.logger.warn(
        'QSTASH_TOKEN tidak diatur; document processing memakai fallback in-process dan tidak durable.',
      );
    }
  }

  registerProcessor(processor: DocumentProcessor): void {
    this.processor = processor;
  }

  async enqueue(documentId: string): Promise<void> {
    if (this.qstash && this.callbackUrl) {
      await this.qstash.publishJSON({
        url: this.callbackUrl,
        body: { documentId },
        retries: 3,
        timeout: '300s',
      });
      return;
    }

    if (!this.processor) throw new Error('Document processor belum terdaftar');
    setImmediate(() => {
      void this.processor?.(documentId).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Document fallback job gagal: ${message}`);
      });
    });
  }

  async verifyAndProcess(
    signature: string | undefined,
    rawBody: string,
    documentId: string,
  ): Promise<void> {
    if (!this.receiver || !this.callbackUrl) {
      throw new ServiceUnavailableException(
        'QStash callback belum dikonfigurasi lengkap.',
      );
    }
    if (!signature) {
      throw new UnauthorizedException('QStash signature tidak tersedia.');
    }

    try {
      await this.receiver.verify({
        signature,
        body: rawBody,
        url: this.callbackUrl,
      });
    } catch {
      throw new UnauthorizedException('QStash signature tidak valid.');
    }

    if (!this.processor) {
      throw new ServiceUnavailableException(
        'Document processor belum terdaftar.',
      );
    }
    await this.processor(documentId);
  }

  getStatus() {
    return {
      provider: this.qstash ? ('qstash' as const) : ('in-process' as const),
      ready: Boolean(this.qstash && this.receiver && this.callbackUrl),
      callbackConfigured: Boolean(this.callbackUrl),
    };
  }
}
