import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  Shipment,
  ShipmentPaymentStatus,
  ShipmentStatus,
} from './entities/shipment.entity';
import { ShipmentsService } from './shipments.service';

function shipmentFixture(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'shipment-1',
    shipmentCode: 'KUB-24081',
    userId: 'user-1',
    originCity: 'Jepara',
    originPort: 'Tanjung Emas, Semarang',
    destinationCountry: 'Jepang',
    destinationPort: 'Tokyo',
    cargoReadyDate: '2026-08-24',
    flexibleDateEnd: '2026-08-31',
    cbm: 4,
    status: ShipmentStatus.AWAITING_MATCH,
    paymentStatus: ShipmentPaymentStatus.UNPAID,
    nextAction: 'Cari container match',
    containerId: null,
    orderAmountIdr: null,
    exporterName: 'Aleka Permana',
    exporterCompany: 'Aleka Ukiran',
    exporterAddress: 'Jalan Jepara 3 Hutama',
    exporterEmail: 'aleka@example.com',
    consigneeName: 'Aiko Tanaka',
    consigneeCompany: 'Mori Living',
    consigneeAddress: 'Aomi, Tokyo',
    consigneeEmail: 'aiko@example.com',
    productDescription: 'Ukiran Jepara',
    productHsCode: '9403.60',
    productCategory: 'Furniture kayu',
    productQuantity: 15,
    productQuantityUnit: 'unit',
    productGrossWeight: 139,
    productNetWeight: 135,
    productWeightUnit: 'kg',
    productPackaging: 'Karton berlapis',
    productStackable: false,
    productFragile: false,
    invoiceNumber: null,
    invoiceDate: null,
    countryOfOrigin: 'Indonesia',
    additionalHandling: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as Shipment;
}

describe('ShipmentsService update cargo', () => {
  const findOne = jest.fn();
  const save = jest.fn();
  const repository = { findOne, save } as unknown as Repository<Shipment>;
  const service = new ShipmentsService(repository);

  beforeEach(() => {
    jest.clearAllMocks();
    save.mockImplementation((shipment: Shipment) => Promise.resolve(shipment));
  });

  it('updates editable cargo fields while preserving unsubmitted product data', async () => {
    const shipment = shipmentFixture();
    findOne.mockResolvedValue(shipment);

    const result = await service.updateShipment('KUB-24081', 'user-1', {
      cargoReadyDate: '2026-08-25',
      flexibleDateEnd: '2026-09-01',
      cbm: 5,
      additionalHandling: '  Gunakan forklift  ',
      product: {
        description: 'Ukiran Jepara premium',
        quantity: 20,
        grossWeight: 160,
        netWeight: 150,
        packaging: 'Peti kayu fumigasi',
      },
    });

    expect(result.cbm).toBe(5);
    expect(result.productDescription).toBe('Ukiran Jepara premium');
    expect(result.productHsCode).toBe('9403.60');
    expect(result.productQuantity).toBe(20);
    expect(result.productPackaging).toBe('Peti kayu fumigasi');
    expect(result.additionalHandling).toBe('Gunakan forklift');
    expect(save).toHaveBeenCalledWith(shipment);
  });

  it('rejects cargo updates after matching', async () => {
    findOne.mockResolvedValue(
      shipmentFixture({ status: ShipmentStatus.MATCHED }),
    );

    await expect(
      service.updateShipment('KUB-24081', 'user-1', { cbm: 6 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects net weight greater than gross weight', async () => {
    findOne.mockResolvedValue(shipmentFixture());

    await expect(
      service.updateShipment('KUB-24081', 'user-1', {
        product: { grossWeight: 100, netWeight: 120 },
      }),
    ).rejects.toThrow('Berat bersih tidak boleh lebih besar dari berat kotor');
  });

  it('rejects a cargo ready date after the flexibility window', async () => {
    findOne.mockResolvedValue(shipmentFixture());

    await expect(
      service.updateShipment('KUB-24081', 'user-1', {
        cargoReadyDate: '2026-09-02',
      }),
    ).rejects.toThrow(
      'Cargo Ready Date tidak boleh melewati batas fleksibel keberangkatan',
    );
  });
});
