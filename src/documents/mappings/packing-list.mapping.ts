import {
  DocumentMapper,
  combine,
  prefer,
  text,
} from './document-mapping.types';

export const mapPackingList: DocumentMapper = (canonical, overrides) => ({
  fields: {
    exporterCompanyAddress: prefer(
      overrides,
      ['exporterCompanyAddress', 'exporter_name_address'],
      combine(canonical.exporter.companyName, canonical.exporter.address),
    ),
    exporterTaxId: prefer(
      overrides,
      ['exporterTaxId', 'exporter_tax_id'],
      canonical.exporter.taxId,
    ),
    exporterContactName: prefer(
      overrides,
      ['exporterContactName'],
      canonical.exporter.contactName,
    ),
    exporterTelephone: prefer(
      overrides,
      ['exporterTelephone'],
      canonical.exporter.phone,
    ),
    exporterEmail: prefer(
      overrides,
      ['exporterEmail'],
      canonical.exporter.email,
    ),
    exporterCountry: prefer(
      overrides,
      ['exporterCountry', 'origin_country'],
      canonical.exporter.country,
    ),
    consigneeCompanyAddress: prefer(
      overrides,
      ['consigneeCompanyAddress', 'consignee_name_address'],
      combine(canonical.consignee.companyName, canonical.consignee.address),
    ),
    consigneeTaxId: prefer(
      overrides,
      ['consigneeTaxId'],
      canonical.consignee.taxId,
    ),
    consigneeContactName: prefer(
      overrides,
      ['consigneeContactName'],
      canonical.consignee.contactName,
    ),
    consigneeTelephone: prefer(
      overrides,
      ['consigneeTelephone'],
      canonical.consignee.phone,
    ),
    consigneeEmail: prefer(
      overrides,
      ['consigneeEmail'],
      canonical.consignee.email,
    ),
    consigneeCountry: prefer(
      overrides,
      ['consigneeCountry', 'destination_country'],
      canonical.consignee.country,
    ),
    shipDate: prefer(
      overrides,
      ['shipDate', 'estimated_departure'],
      canonical.route.estimatedDeparture ?? canonical.route.cargoReadyDate,
    ),
    airWaybillNo: prefer(
      overrides,
      ['airWaybillNo'],
      canonical.billOfLading?.number,
    ),
    invoiceNo: prefer(
      overrides,
      ['invoiceNo', 'invoice_number'],
      canonical.commercial?.invoiceNumber,
    ),
    purchaseOrderNo: prefer(
      overrides,
      ['purchaseOrderNo'],
      canonical.commercial?.purchaseOrderNumber,
    ),
    paymentTerms: prefer(
      overrides,
      ['paymentTerms'],
      canonical.commercial?.paymentTerms,
    ),
    billOfLading: prefer(
      overrides,
      ['billOfLading', 'bol_number'],
      canonical.billOfLading?.number,
    ),
    packageType: prefer(
      overrides,
      ['packageType', 'package_type'],
      canonical.cargo.packageType,
    ),
    specialInstructions: prefer(
      overrides,
      ['specialInstructions'],
      canonical.cargo.specialHandling,
    ),
    totalGrossWeight: prefer(
      overrides,
      ['totalGrossWeight', 'gross_weight'],
      canonical.cargo.grossWeightKg === undefined
        ? ''
        : `${canonical.cargo.grossWeightKg} kg`,
    ),
    signatureNameTitleDate: prefer(
      overrides,
      ['signatureNameTitleDate'],
      combine(
        canonical.exporter.contactName,
        canonical.facts.exporter_title,
        canonical.route.estimatedDeparture,
      ),
    ),
  },
  items: canonical.items.map((item) => ({
    noOfPackages: text(item.packageCount),
    noOfUnits: text(item.quantity),
    netWeight: item.netWeightKg === undefined ? '' : `${item.netWeightKg} kg`,
    unitOfMeasure: text(item.quantityUnit),
    goodsDescription: text(item.description),
    countryOfManufacture: text(
      item.countryOfOrigin ?? canonical.route.originCountry,
    ),
  })),
});
