import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CreateDocumentDto } from './dto/create-document.dto';
import { DocumentType } from './entities/document.entity';
import { DocumentsService } from './documents.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import { DocumentIntelligenceService } from './document-intelligence.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { CorrectExtractedFieldDto } from './dto/correct-extracted-field.dto';
import { DocumentAssistantService } from './document-assistant.service';
import { GenerateDocumentDraftDto } from './dto/generate-document-draft.dto';
import { ResolveDocumentConflictDto } from './dto/resolve-document-conflict.dto';
import {
  CompleteDocumentUploadDto,
  CreateDocumentUploadDto,
} from './dto/create-document-upload.dto';

@ApiTags('Documents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly intelligenceService: DocumentIntelligenceService,
  ) {}

  @Get('types')
  @ApiOperation({ summary: 'Daftar semua jenis dokumen ekspor yang tersedia' })
  getDocumentTypes() {
    return { data: this.documentsService.getDocumentTypes() };
  }

  @Get('schema/:type')
  @ApiOperation({ summary: 'Ambil schema field untuk jenis dokumen tertentu' })
  @ApiParam({ name: 'type', enum: DocumentType })
  getSchema(@Param('type') type: DocumentType) {
    return { data: this.documentsService.getDocumentSchema(type) };
  }

  @Post()
  @ApiOperation({ summary: 'Buat dokumen ekspor baru dengan field yang diisi' })
  async createDocument(
    @CurrentUser() user: User,
    @Body() dto: CreateDocumentDto,
  ) {
    const doc = await this.documentsService.createDocument(user.id, dto);
    return { message: 'Document generated successfully', data: doc };
  }

  @Get()
  @ApiOperation({ summary: 'Daftar semua dokumen milik user' })
  @ApiQuery({ name: 'shipmentId', required: false })
  async getMyDocuments(
    @CurrentUser() user: User,
    @Query('shipmentId') shipmentId?: string,
  ) {
    const docs = await this.documentsService.getUserDocuments(
      user.id,
      shipmentId,
    );
    return { data: docs };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail dokumen berdasarkan ID' })
  async getDocument(@CurrentUser() user: User, @Param('id') id: string) {
    const doc = await this.documentsService.getDocumentById(id, user.id);
    if (doc.processingStatus) {
      const [document, fields] = await Promise.all([
        this.intelligenceService.getDocument(id, user.id),
        this.intelligenceService.getExtractions(id, user.id),
      ]);
      return { data: { ...document, fields } };
    }
    return { data: doc };
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Status pemrosesan document intelligence' })
  async getProcessingStatus(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    const document = await this.intelligenceService.getDocument(id, user.id);
    return { data: document };
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Buat signed URL sementara untuk file private' })
  @ApiQuery({ name: 'format', required: false, enum: ['pdf', 'docx'] })
  async getDownloadUrl(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query('format') format: 'pdf' | 'docx' = 'pdf',
  ) {
    if (!['pdf', 'docx'].includes(format)) {
      throw new BadRequestException('format harus pdf atau docx');
    }
    return {
      data: await this.intelligenceService.getDownloadUrl(id, user.id, format),
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Hapus record dan file dokumen private' })
  async deleteDocument(@CurrentUser() user: User, @Param('id') id: string) {
    return {
      message: 'Document deleted successfully',
      data: await this.intelligenceService.deleteDocument(id, user.id),
    };
  }

  @Get(':id/extractions')
  @ApiOperation({ summary: 'Field hasil ekstraksi beserta provenance' })
  async getExtractions(@CurrentUser() user: User, @Param('id') id: string) {
    return { data: await this.intelligenceService.getExtractions(id, user.id) };
  }

  @Post(':id/reprocess')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Antrekan ulang parsing/OCR dan ekstraksi' })
  async reprocess(@CurrentUser() user: User, @Param('id') id: string) {
    return {
      message: 'Document reprocessing queued',
      data: await this.intelligenceService.reprocess(id, user.id),
    };
  }
}

@ApiTags('Document Intelligence')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class DocumentIntelligenceController {
  constructor(
    private readonly intelligenceService: DocumentIntelligenceService,
    private readonly assistantService: DocumentAssistantService,
  ) {}

  @Get('shipments/:shipmentId/document-assistant')
  @ApiOperation({
    summary: 'Shipment document readiness and knowledge overview',
  })
  async getAssistantOverview(
    @CurrentUser() user: User,
    @Param('shipmentId') shipmentId: string,
  ) {
    return {
      data: await this.assistantService.getOverview(shipmentId, user.id),
    };
  }

  @Get('shipments/:shipmentId/document-readiness/:type')
  @ApiOperation({
    summary: 'Known, missing, conflicting, and external fields for a draft',
  })
  @ApiParam({ name: 'type', enum: DocumentType })
  async getDocumentReadiness(
    @CurrentUser() user: User,
    @Param('shipmentId') shipmentId: string,
    @Param('type') type: DocumentType,
  ) {
    return {
      data: await this.assistantService.getReadiness(shipmentId, user.id, type),
    };
  }

  @Get('shipments/:shipmentId/document-history')
  @ApiOperation({
    summary: 'Generated, uploaded, and checked document history by shipment',
  })
  async getDocumentHistory(
    @CurrentUser() user: User,
    @Param('shipmentId') shipmentId: string,
  ) {
    return {
      data: await this.assistantService.getHistory(shipmentId, user.id),
    };
  }

  @Get('shipments/:shipmentId/documents/:documentId/validation')
  @ApiOperation({
    summary: 'Validate an uploaded document against shipment knowledge',
  })
  async validateUploadedDocument(
    @CurrentUser() user: User,
    @Param('shipmentId') shipmentId: string,
    @Param('documentId') documentId: string,
  ) {
    return {
      data: await this.assistantService.validateUploadedDocument(
        shipmentId,
        documentId,
        user.id,
      ),
    };
  }

  @Post('shipments/:shipmentId/document-conflicts/resolve')
  @ApiOperation({
    summary: 'Persist a user-confirmed canonical shipment value',
  })
  async resolveDocumentConflict(
    @CurrentUser() user: User,
    @Param('shipmentId') shipmentId: string,
    @Body() dto: ResolveDocumentConflictDto,
  ) {
    return {
      message: 'Conflict resolved with user confirmation',
      data: await this.assistantService.resolveConflict(
        shipmentId,
        user.id,
        dto,
      ),
    };
  }

  @Post('shipments/:shipmentId/document-drafts/:type')
  @ApiOperation({
    summary: 'Generate a controlled AI draft from shipment knowledge',
  })
  @ApiParam({ name: 'type', enum: DocumentType })
  async generateDocumentDraft(
    @CurrentUser() user: User,
    @Param('shipmentId') shipmentId: string,
    @Param('type') type: DocumentType,
    @Body() dto: GenerateDocumentDraftDto,
  ) {
    return {
      message: 'AI draft generated; not an official document',
      data: await this.assistantService.generateDraft(
        shipmentId,
        user.id,
        type,
        dto,
      ),
    };
  }

  @Post('shipments/:shipmentId/documents')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  @ApiOperation({
    summary:
      'Upload sekali, proses asynchronous, dan reuse field pada shipment',
  })
  async upload(
    @CurrentUser() user: User,
    @Param('shipmentId') shipmentId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
  ) {
    return {
      message: 'Document accepted for processing',
      data: await this.intelligenceService.upload(
        user.id,
        shipmentId,
        file,
        dto,
      ),
    };
  }

  @Post('shipments/:shipmentId/documents/upload-url')
  @ApiOperation({
    summary: 'Buat signed URL agar file langsung diunggah ke Supabase Storage',
  })
  async createUploadUrl(
    @CurrentUser() user: User,
    @Param('shipmentId') shipmentId: string,
    @Body() dto: CreateDocumentUploadDto,
  ) {
    return {
      data: await this.intelligenceService.createUploadUrl(
        user.id,
        shipmentId,
        dto,
      ),
    };
  }

  @Post('shipments/:shipmentId/documents/complete-upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Daftarkan upload Supabase dan antrekan OCR melalui QStash',
  })
  async completeUpload(
    @CurrentUser() user: User,
    @Param('shipmentId') shipmentId: string,
    @Body() dto: CompleteDocumentUploadDto,
  ) {
    return {
      message: 'Document accepted for processing',
      data: await this.intelligenceService.completeUpload(
        user.id,
        shipmentId,
        dto,
      ),
    };
  }

  @Patch('extracted-fields/:fieldId')
  @ApiOperation({
    summary: 'Koreksi field dan perbarui canonical shipment fact',
  })
  async correctField(
    @CurrentUser() user: User,
    @Param('fieldId') fieldId: string,
    @Body() dto: CorrectExtractedFieldDto,
  ) {
    return {
      message: 'Extracted field corrected',
      data: await this.intelligenceService.correctField(fieldId, user.id, dto),
    };
  }

  @Get('shipments/:shipmentId/document-facts')
  @ApiOperation({
    summary: 'Canonical facts yang dapat dipakai semua dokumen shipment',
  })
  async getFacts(
    @CurrentUser() user: User,
    @Param('shipmentId') shipmentId: string,
  ) {
    return {
      data: await this.intelligenceService.getShipmentFacts(
        shipmentId,
        user.id,
      ),
    };
  }
}
