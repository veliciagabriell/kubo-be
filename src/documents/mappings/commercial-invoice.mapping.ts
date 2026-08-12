import {
  DocumentMapper,
  amount,
  combine,
  prefer,
  text,
} from './document-mapping.types';

export const mapCommercialInvoice: DocumentMapper = (canonical, overrides) => {
  const currency = prefer(
    overrides,
    ['currency'],
    canonical.commercial?.currency,
  );
  const items = canonical.items.map((item) => {
    const unitValue = item.unitPrice ?? canonical.commercial?.unitPrice;
    const totalValue =
      item.totalValue ??
      (unitValue === undefined || item.quantity === undefined
        ? undefined
        : unitValue * item.quantity);
    return {
      noOfPkgs: text(item.packageCount),
      goodsDescription: text(item.description),
      qty: [text(item.quantity), text(item.quantityUnit)]
        .filter(Boolean)
        .join(' '),
      unitValue: amount(unitValue, currency),
      totalValue: amount(totalValue, currency),
    };
  });
  return {
    fields: {
      dateOfExportation: prefer(
        overrides,
        ['dateOfExportation', 'invoice_date'],
        canonical.commercial?.invoiceDate ?? canonical.route.estimatedDeparture,
      ),
      invoiceNumber: prefer(
        overrides,
        ['invoiceNumber', 'invoice_number'],
        canonical.commercial?.invoiceNumber,
      ),
      airwaybillNo: prefer(
        overrides,
        ['airwaybillNo', 'bol_number'],
        canonical.billOfLading?.number,
      ),
      shipperNameAddress: prefer(
        overrides,
        ['shipperNameAddress', 'exporter_name_address'],
        combine(
          canonical.exporter.companyName,
          canonical.exporter.contactName,
          canonical.exporter.address,
        ),
      ),
      consigneeNameAddress: prefer(
        overrides,
        ['consigneeNameAddress', 'consignee_name_address'],
        combine(
          canonical.consignee.companyName,
          canonical.consignee.contactName,
          canonical.consignee.address,
        ),
      ),
      importerNameAddress: prefer(
        overrides,
        ['importerNameAddress'],
        combine(canonical.consignee.companyName, canonical.consignee.address),
      ),
      countryOfExport: prefer(
        overrides,
        ['countryOfExport', 'origin_country'],
        canonical.route.originCountry,
      ),
      countryOfManufacture: prefer(
        overrides,
        ['countryOfManufacture', 'country_of_origin'],
        canonical.cargo.countryOfOrigin,
      ),
      countryOfUltimateDestination: prefer(
        overrides,
        ['countryOfUltimateDestination', 'destination_country'],
        canonical.route.destinationCountry,
      ),
      totalInvoiceValue: prefer(
        overrides,
        ['totalInvoiceValue', 'total_value'],
        amount(canonical.commercial?.totalValue, currency),
      ),
      signatureName: prefer(
        overrides,
        ['signatureName'],
        combine(canonical.exporter.contactName, canonical.facts.exporter_title),
      ),
    },
    items,
  };
};
