import { runRepositoryContract } from './contract';
import { InMemoryRepository } from '../../src/repository/inMemory';

runRepositoryContract('InMemory', async () => new InMemoryRepository());
