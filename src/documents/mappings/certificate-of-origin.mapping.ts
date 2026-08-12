import {
  DocumentMapper,
  combine,
  prefer,
  text,
} from './document-mapping.types';

export const mapCertificateOfOrigin: DocumentMapper = (
  canonical,
  overrides,
) => ({
  fields: {
    exporterNameAddress: prefer(
      overrides,
      ['exporterNameAddress', 'exporter_name_address'],
      combine(
        canonical.exporter.companyName,
        canonical.exporter.contactName,
        canonical.exporter.address,
        canonical.exporter.country,
      ),
    ),
    exporterTaxId: prefer(
      overrides,
      ['exporterTaxId', 'exporter_tax_id'],
      canonical.exporter.taxId,
    ),
    blanketPeriodFrom: prefer(
      overrides,
      ['blanketPeriodFrom'],
      canonical.facts.blanket_period_from,
    ),
    blanketPeriodTo: prefer(
      overrides,
      ['blanketPeriodTo'],
      canonical.facts.blanket_period_to,
    ),
    producerNameAddress: prefer(
      overrides,
      ['producerNameAddress'],
      combine(canonical.exporter.companyName, canonical.exporter.address),
    ),
    importerNameAddress: prefer(
      overrides,
      ['importerNameAddress', 'consignee_name_address'],
      combine(
        canonical.consignee.companyName,
        canonical.consignee.contactName,
        canonical.consignee.address,
        canonical.consignee.country,
      ),
    ),
    certifyingRole: prefer(overrides, ['certifyingRole'], 'Exporter'),
    certifyingCompany: prefer(
      overrides,
      ['certifyingCompany'],
      canonical.exporter.companyName,
    ),
    certifyingName: prefer(
      overrides,
      ['certifyingName'],
      canonical.exporter.contactName,
    ),
    certifyingTitle: prefer(
      overrides,
      ['certifyingTitle'],
      canonical.facts.exporter_title,
    ),
    certifyingDate: prefer(
      overrides,
      ['certifyingDate'],
      canonical.commercial?.invoiceDate ?? canonical.route.cargoReadyDate,
    ),
    certifyingTelephone: prefer(
      overrides,
      ['certifyingTelephone'],
      canonical.exporter.phone,
    ),
  },
  items: canonical.items.map((item) => ({
    goodsDescription: text(item.description),
    hsCode: text(item.hsCode),
    countryOfOrigin: text(
      item.countryOfOrigin ?? canonical.route.originCountry,
    ),
  })),
});
