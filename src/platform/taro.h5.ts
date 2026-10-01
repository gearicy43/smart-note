import { createServices } from '../core';
import { SqliteRepository } from '../repository/sqlite';

const id = () => `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

// Keep using the existing browser database so switching the H5 preview does
// not hide notes already written in the old Vite page.
export const services = createServices(new SqliteRepository(), id);
