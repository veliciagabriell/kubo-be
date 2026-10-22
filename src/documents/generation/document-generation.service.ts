import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseStorageService } from '../../supabase/supabase-storage.service';
import { CanonicalShipmentService } from '../canonical/canonical-shipment.service';
import {
  Document,
  DocumentOrigin,
  DocumentType,
} from '../entities/document.entity';
import { MappedDocumentData } from '../mappings/document-mapping.types';
import { DocxTemplateRenderer } from '../renderers/docx-template.renderer';
import { TemplatePdfRenderer } from '../renderers/template-pdf.renderer';
import { DocumentTemplateRegistry } from '../templates/document-template.registry';
import {
  MissingTemplateField,
  validateTemplateFields,
} from '../validation/template-field.validator';

export interface AdditionalInformationRequiredResult {
  status: 'additional_information_required';
  missingFields: MissingTemplateField[];
}

export interface GeneratedTemplateDocumentResult {
  status: 'draft_generated';
  document: Omit<Document, 'fields' | 'items'> & {
    fields: Record<string, string>;
    items: Record<string, string>[];
  };
}

@Injectable()
export class DocumentGenerationService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    private readonly canonicalService: CanonicalShipmentService,
    private readonly registry: DocumentTemplateRegistry,
    private readonly docxRenderer: DocxTemplateRenderer,
    private readonly pdfRenderer: TemplatePdfRenderer,
    private readonly storage: SupabaseStorageService,
  ) {}

  async generateDocument(
    shipmentId: string,
    userId: string,
    type: DocumentType,
    overrides: Record<string, string> = {},
    suppliedItems?: Record<string, string>[],
  ): Promise<
    AdditionalInformationRequiredResult | GeneratedTemplateDocumentResult
  > {
    const canonical = await this.canonicalService.getShipmentData(
      shipmentId,
      userId,
    );
    const definition = this.registry.get(type);
    const mapped = definition.mapper(canonical, overrides);
    if (suppliedItems?.length)
      mapped.items = this.mergeItems(mapped, suppliedItems);
    const validation = validateTemplateFields(definition, mapped);
    if (!validation.valid)
      return {
        status: 'additional_information_required',
        missingFields: validation.missingFields,
      };

    const templatePath = this.registry.resolvePath(definition);
    const [docxBuffer, pdfBuffer] = await Promise.all([
      this.docxRenderer.render(templatePath, definition, mapped),
      Promise.resolve(this.pdfRenderer.render(definition, mapped)),
    ]);
    const latest = await this.documentRepo.findOne({
      where: {
        shipmentId: canonical.shipmentId,
        userId,
        type,
        documentOrigin: DocumentOrigin.GENERATED,
      },
      order: { fileVersion: 'DESC' },
    });
    const fileVersion = (latest?.fileVersion ?? 0) + 1;
    const snapshotId = uuidv4();
    const safeShipment = canonical.shipmentCode.replace(/[^A-Za-z0-9_-]/g, '_');
    const baseName = `${type.toLowerCase()}-${safeShipment}-DRAFT-v${fileVersion}-${snapshotId.slice(0, 8)}`;
    const docxName = `${baseName}.docx`;
    const pdfName = `${baseName}.pdf`;
    const objectDirectory = `users/${userId}/shipments/${canonical.shipmentId}/generated-documents`;
    const docxFileUrl = await this.storage.upload(
      `${objectDirectory}/${docxName}`,
      docxBuffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    let fileUrl: string;
    try {
      fileUrl = await this.storage.upload(
        `${objectDirectory}/${pdfName}`,
        pdfBuffer,
        'application/pdf',
      );
    } catch (error) {
      await this.storage.remove([docxFileUrl]);
      throw error;
    }
    const sources = [
      'company_profile',
      'shipment',
      'cargo',
      ...(canonical.containerMatch ? ['container_match'] : []),
      ...(Object.keys(canonical.facts).length ? ['uploaded_document'] : []),
    ];
    const entity = this.documentRepo.create({
      userId,
      shipmentId: canonical.shipmentId,
      type,
      fields: JSON.stringify(mapped.fields),
      items: JSON.stringify(mapped.items),
      generatedContent: null,
      documentOrigin: DocumentOrigin.GENERATED,
      templateVersion: definition.version,
      shipmentSnapshotId: snapshotId,
      generatedAt: new Date(),
      generatedBy: userId,
      generatedSources: JSON.stringify(sources),
      fileUrl,
      docxFileUrl,
      originalFileName: `${definition.label}_${canonical.shipmentCode}_DRAFT_v${fileVersion}.pdf`,
      mimeType: 'application/pdf',
      fileSize: pdfBuffer.length,
      fileVersion,
      status: 'draft_generated',
    });
    let saved: Document;
    try {
      saved = await this.documentRepo.save(entity);
    } catch (error) {
      await this.storage.remove([fileUrl, docxFileUrl]);
      throw error;
    }
    return {
      status: 'draft_generated',
      document: {
        ...saved,
        fields: mapped.fields,
        items: mapped.items,
      },
    };
  }

  private mergeItems(
    mapped: MappedDocumentData,
    supplied: Record<string, string>[],
  ): Record<string, string>[] {
    return supplied.map((item, index) => {
      const base = mapped.items[index] ?? mapped.items[0] ?? {};
      const provided = Object.fromEntries(
        Object.entries(item)
          .filter(([, value]) => value?.trim())
          .map(([key, value]) => {
            const current = base[key] ?? '';
            const trimmed = value.trim();
            const keepFormattedCanonical =
              /^-?\d+(?:\.\d+)?$/.test(trimmed) &&
              current.startsWith(trimmed) &&
              /[A-Za-z]/.test(current);
            return [key, keepFormattedCanonical ? current : trimmed];
          }),
      );
      return { ...base, ...provided };
    });
  }
}
