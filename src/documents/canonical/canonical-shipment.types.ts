export interface CanonicalParty {
  companyName?: string;
  contactName?: string;
  address?: string;
  country?: string;
  taxId?: string;
  phone?: string;
  email?: string;
}

export interface CanonicalShipmentItem {
  description?: string;
  hsCode?: string;
  quantity?: number;
  quantityUnit?: string;
  grossWeightKg?: number;
  netWeightKg?: number;
  packageCount?: number;
  packageType?: string;
  countryOfOrigin?: string;
  unitPrice?: number;
  totalValue?: number;
}

export interface CanonicalShipmentData {
  shipmentId: string;
  shipmentCode: string;
  exporter: CanonicalParty;
  consignee: CanonicalParty;
  cargo: CanonicalShipmentItem & {
    finalCbm?: number;
    specialHandling?: string;
  };
  items: CanonicalShipmentItem[];
  route: {
    originPort?: string;
    destinationPort?: string;
    originCountry?: string;
    destinationCountry?: string;
    cargoReadyDate?: string;
    estimatedDeparture?: string;
    cargoCutoff?: string;
  };
  containerMatch?: {
    shipmentType?: string;
    freightForwarderName?: string;
    vesselName?: string;
    voyageNumber?: string;
    bookingNumber?: string;
    containerNumber?: string;
    sealNumber?: string;
  };
  commercial?: {
    invoiceNumber?: string;
    invoiceDate?: string;
    currency?: string;
    unitPrice?: number;
    totalValue?: number;
    paymentTerms?: string;
    purchaseOrderNumber?: string;
  };
  billOfLading?: { number?: string };
  facts: Record<string, string>;
}
