import { SqliteRepository } from '../repository/sqlite';
import { realId } from '../infra/uuid';
import { createServices } from '../core';

export const createWebServices = () => createServices(new SqliteRepository(), realId);
