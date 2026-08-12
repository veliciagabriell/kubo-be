import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { readFile } from 'fs/promises';
import JSZip from 'jszip';
import { MappedDocumentData } from '../mappings/document-mapping.types';
import { DocumentTemplateDefinition } from '../templates/document-template.registry';

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function replaceCellText(cellXml: string, value: string): string {
  const paragraphs = value.split(/\r?\n/);
  let used = false;
  const replacement = cellXml.replace(
    /<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g,
    (node) => {
      if (used) return node.replace(/>[^<]*<\/w:t>/, '></w:t>');
      used = true;
      const content = paragraphs.map(xmlEscape).join('</w:t><w:br/><w:t>');
      return node.replace(
        />[^<]*<\/w:t>/,
        ` xml:space="preserve">${content}</w:t>`,
      );
    },
  );
  if (used) return replacement;
  return replacement.replace(
    '</w:tc>',
    `<w:p><w:r><w:t xml:space="preserve">${paragraphs.map(xmlEscape).join('</w:t><w:br/><w:t>')}</w:t></w:r></w:p></w:tc>`,
  );
}

function replaceRowCells(rowXml: string, values: string[]): string {
  let index = 0;
  return rowXml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) =>
    index < values.length ? replaceCellText(cell, values[index++]) : cell,
  );
}

function updateTable(
  tableXml: string,
  bindings: Array<{ row: number; column: number; value: string }>,
  itemBinding: DocumentTemplateDefinition['itemTable'] | null,
  items: Record<string, string>[],
): string {
  const rows = tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
  bindings.forEach(({ row, column, value }) => {
    if (!rows[row]) return;
    let cellIndex = 0;
    rows[row] = rows[row].replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) =>
      cellIndex++ === column ? replaceCellText(cell, value) : cell,
    );
  });
  if (itemBinding && rows[itemBinding.row]) {
    const sourceRow = rows[itemBinding.row];
    const renderedRows = (items.length ? items : [{}]).map((item) =>
      replaceRowCells(
        sourceRow,
        itemBinding.columns.map((column) => item[column] ?? ''),
      ),
    );
    rows.splice(itemBinding.row, 1, ...renderedRows);
  }
  let rowIndex = 0;
  return tableXml
    .replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, () => rows[rowIndex++] ?? '')
    .replace(
      '</w:tbl>',
      rowIndex < rows.length
        ? `${rows.slice(rowIndex).join('')}</w:tbl>`
        : '</w:tbl>',
    );
}

@Injectable()
export class DocxTemplateRenderer {
  async render(
    templatePath: string,
    definition: DocumentTemplateDefinition,
    mapped: MappedDocumentData,
  ): Promise<Buffer> {
    const zip = await JSZip.loadAsync(await readFile(templatePath));
    const documentFile = zip.file('word/document.xml');
    if (!documentFile)
      throw new InternalServerErrorException('Invalid DOCX template');
    const documentXml = await documentFile.async('string');
    const tableBindings = new Map<
      number,
      Array<{ row: number; column: number; value: string }>
    >();
    Object.entries(definition.cellBindings).forEach(([field, binding]) => {
      const list = tableBindings.get(binding.table) ?? [];
      list.push({ ...binding, value: mapped.fields[field] ?? '' });
      tableBindings.set(binding.table, list);
    });
    let tableIndex = 0;
    const renderedXml = documentXml.replace(
      /<w:tbl\b[\s\S]*?<\/w:tbl>/g,
      (table) => {
        const current = tableIndex++;
        return updateTable(
          table,
          tableBindings.get(current) ?? [],
          definition.itemTable.table === current ? definition.itemTable : null,
          mapped.items,
        );
      },
    );
    zip.file('word/document.xml', renderedXml);
    return zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  }
}
