import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';

const QUEUE_NAME = 'document-intelligence';

type DocumentProcessor = (documentId: string) => Promise<void>;
interface DocumentJob {
  documentId: string;
}

@Injectable()
export class DocumentProcessingQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentProcessingQueueService.name);
  private readonly queue: Queue<DocumentJob> | null;
  private worker: Worker<DocumentJob> | null = null;
  private processor: DocumentProcessor | null = null;

  constructor(private readonly config: ConfigService) {
    const redisUrl = this.config.get<string>('REDIS_URL');
    this.queue = redisUrl
      ? new Queue(QUEUE_NAME, { connection: this.redisConnection(redisUrl) })
      : null;
    this.queue?.on('error', (error) => {
      this.logger.error(`Redis queue error: ${error.message}`);
    });

    if (!redisUrl) {
      this.logger.warn(
        'REDIS_URL tidak diatur; document processing memakai fallback in-process dan tidak durable.',
      );
    }
  }

  registerProcessor(processor: DocumentProcessor): void {
    this.processor = processor;
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl || this.worker) return;

    const configuredConcurrency = Number(
      this.config.get<string>('DOCUMENT_WORKER_CONCURRENCY') ?? 2,
    );
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => processor(job.data.documentId),
      {
        connection: this.redisConnection(redisUrl),
        concurrency:
          Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
            ? configuredConcurrency
            : 2,
      },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Document job ${job?.id ?? 'unknown'} gagal: ${error.message}`,
      );
    });
    this.worker.on('error', (error) => {
      this.logger.error(`Redis worker error: ${error.message}`);
    });
  }

  async enqueue(documentId: string): Promise<void> {
    if (this.queue) {
      await this.queue.add(
        'process',
        { documentId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );
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

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private redisConnection(redisUrl: string) {
    const url = new URL(redisUrl);
    const database = url.pathname.slice(1);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      db: database ? Number(database) : 0,
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    };
  }
}
