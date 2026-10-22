import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { DocumentProcessingQueueService } from './document-processing-queue.service';

interface DocumentProcessingBody {
  documentId?: unknown;
}

@Controller('internal/document-processing')
export class DocumentProcessingController {
  constructor(
    private readonly processingQueue: DocumentProcessingQueueService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async process(
    @Req() request: RawBodyRequest<Request>,
    @Headers('upstash-signature') signature: string | undefined,
    @Body() body: DocumentProcessingBody,
  ) {
    if (typeof body.documentId !== 'string' || !body.documentId.trim()) {
      throw new BadRequestException('documentId wajib diisi.');
    }
    const rawBody = request.rawBody?.toString('utf8');
    if (!rawBody) {
      throw new BadRequestException('Raw request body tidak tersedia.');
    }

    await this.processingQueue.verifyAndProcess(
      signature,
      rawBody,
      body.documentId,
    );
    return { processed: true, documentId: body.documentId };
  }
}
