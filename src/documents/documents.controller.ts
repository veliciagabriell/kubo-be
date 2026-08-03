import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
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

@ApiTags('Documents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

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
    return { data: doc };
  }
}
