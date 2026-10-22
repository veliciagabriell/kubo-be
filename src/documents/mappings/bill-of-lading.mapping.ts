import {
  DocumentMapper,
  combine,
  prefer,
  text,
} from './document-mapping.types';

export const mapBillOfLading: DocumentMapper = (canonical, overrides) => ({
  fields: {
    bolDate: prefer(
      overrides,
      ['bolDate', 'estimated_departure'],
      canonical.route.estimatedDeparture ?? canonical.route.cargoReadyDate,
    ),
    bolNumber: prefer(
      overrides,
      ['bolNumber', 'bol_number'],
      canonical.billOfLading?.number,
    ),
    shipFromNameAddress: prefer(
      overrides,
      ['shipFromNameAddress', 'exporter_name_address'],
      combine(
        canonical.exporter.companyName,
        canonical.exporter.contactName,
        canonical.exporter.address,
        canonical.exporter.country,
      ),
    ),
    shipFromSid: prefer(
      overrides,
      ['shipFromSid', 'exporter_tax_id'],
      canonical.exporter.taxId,
    ),
    shipToNameAddress: prefer(
      overrides,
      ['shipToNameAddress', 'consignee_name_address'],
      combine(
        canonical.consignee.companyName,
        canonical.consignee.contactName
          ? `Attn: ${canonical.consignee.contactName}`
          : '',
        canonical.consignee.address,
        canonical.consignee.country,
      ),
    ),
    shipToLocationNo: prefer(
      overrides,
      ['shipToLocationNo'],
      canonical.facts.consignee_location_number,
    ),
    shipToCid: prefer(
      overrides,
      ['shipToCid', 'consignee_tax_id'],
      canonical.consignee.taxId,
    ),
    carrierName: prefer(
      overrides,
      ['carrierName', 'freight_forwarder_name'],
      canonical.containerMatch?.freightForwarderName,
    ),
    trailerNo: prefer(overrides, ['trailerNo'], canonical.facts.trailer_number),
    sealNumbers: prefer(
      overrides,
      ['sealNumbers', 'seal_number'],
      canonical.containerMatch?.sealNumber,
    ),
    scac: prefer(overrides, ['scac'], canonical.facts.scac),
    proNo: prefer(overrides, ['proNo'], canonical.facts.pro_number),
    thirdPartyBillTo: prefer(
      overrides,
      ['thirdPartyBillTo'],
      canonical.facts.third_party_bill_to,
    ),
    freightChargeTerms: prefer(
      overrides,
      ['freightChargeTerms', 'payment_terms'],
      canonical.commercial?.paymentTerms,
    ),
    codAmount: prefer(overrides, ['codAmount'], canonical.facts.cod_amount),
    specialInstructions: combine(
      prefer(
        overrides,
        ['specialInstructions'],
        canonical.cargo.specialHandling,
      ),
      canonical.route.originPort
        ? `Port of Loading: ${canonical.route.originPort}`
        : '',
      canonical.route.destinationPort
        ? `Port of Discharge: ${canonical.route.destinationPort}`
        : '',
      canonical.containerMatch?.vesselName
        ? `Vessel: ${canonical.containerMatch.vesselName}`
        : '',
      canonical.cargo.finalCbm === undefined
        ? ''
        : `Measurement: ${canonical.cargo.finalCbm} CBM`,
    ),
    shipperSignatureDate: prefer(
      overrides,
      ['shipperSignatureDate'],
      canonical.facts.shipper_signature_date,
    ),
    portOfLoading: prefer(
      overrides,
      ['portOfLoading', 'port_of_loading'],
      canonical.route.originPort,
    ),
    portOfDischarge: prefer(
      overrides,
      ['portOfDischarge', 'port_of_discharge'],
      canonical.route.destinationPort,
    ),
    vesselName: prefer(
      overrides,
      ['vesselName', 'vessel_name'],
      canonical.containerMatch?.vesselName,
    ),
    voyageNumber: prefer(
      overrides,
      ['voyageNumber', 'voyage_number'],
      canonical.containerMatch?.voyageNumber,
    ),
    bookingNumber: prefer(
      overrides,
      ['bookingNumber', 'booking_number'],
      canonical.containerMatch?.bookingNumber,
    ),
    containerNumber: prefer(
      overrides,
      ['containerNumber', 'container_number'],
      canonical.containerMatch?.containerNumber,
    ),
    measurementCbm: (() => {
      const value = prefer(
        overrides,
        ['measurementCbm', 'cbm'],
        canonical.cargo.finalCbm,
      );
      return value && !/cbm/i.test(value) ? `${value} CBM` : value;
    })(),
  },
  items: canonical.items.map((item) => ({
    handlingUnitQty: text(item.quantity),
    handlingUnitType: text(item.quantityUnit),
    packageQty: text(item.packageCount),
    packageType: text(item.packageType),
    weight: item.grossWeightKg === undefined ? '' : `${item.grossWeightKg} kg`,
    goodsDescription: text(item.description),
    nmfcNo: '',
    freightClass: '',
  })),
});
