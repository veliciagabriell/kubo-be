import { Repository } from 'typeorm';
import { Vessel } from '../vessels/entities/vessel.entity';
import { Voyage } from '../vessels/entities/voyage.entity';
import { DevelopmentMatchingFixtureService } from './development-matching-fixture.service';
import { Container } from './entities/container.entity';

describe('DevelopmentMatchingFixtureService', () => {
  const originalAppEnv = process.env.APP_ENV;
  const originalFixtureEnabled = process.env.MATCHING_FIXTURE_ENABLED;
  let vesselRepo: jest.Mocked<
    Pick<Repository<Vessel>, 'findOneBy' | 'create' | 'save'>
  >;
  let voyageRepo: jest.Mocked<
    Pick<Repository<Voyage>, 'findOneBy' | 'create' | 'save'>
  >;
  let containerRepo: jest.Mocked<
    Pick<Repository<Container>, 'findOneBy' | 'create' | 'save'>
  >;
  let service: DevelopmentMatchingFixtureService;

  beforeEach(() => {
    const repository = () => ({
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    });
    vesselRepo = repository();
    voyageRepo = repository();
    containerRepo = repository();
    service = new DevelopmentMatchingFixtureService(
      vesselRepo as unknown as Repository<Vessel>,
      voyageRepo as unknown as Repository<Voyage>,
      containerRepo as unknown as Repository<Container>,
    );
  });

  afterEach(() => {
    if (originalAppEnv == null) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalAppEnv;
    if (originalFixtureEnabled == null)
      delete process.env.MATCHING_FIXTURE_ENABLED;
    else process.env.MATCHING_FIXTURE_ENABLED = originalFixtureEnabled;
  });

  it('creates three clearly labelled fixture candidates in development', async () => {
    process.env.APP_ENV = 'development';
    process.env.MATCHING_FIXTURE_ENABLED = 'true';

    await service.onModuleInit();

    expect(vesselRepo.save).toHaveBeenCalledTimes(3);
    expect(voyageRepo.save).toHaveBeenCalledTimes(3);
    expect(containerRepo.save).toHaveBeenCalledTimes(3);
    expect(containerRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSource: 'development_fixture',
        destinationCountry: 'Japan',
      }),
    );
  });

  it('refuses to create fixtures outside development or test', async () => {
    process.env.APP_ENV = 'production';
    process.env.MATCHING_FIXTURE_ENABLED = 'true';

    await service.onModuleInit();

    expect(vesselRepo.save).not.toHaveBeenCalled();
    expect(voyageRepo.save).not.toHaveBeenCalled();
    expect(containerRepo.save).not.toHaveBeenCalled();
  });
});
