import { createContext, useContext, ReactNode } from 'react';
import { NodeService, ProjectService } from '../core';

export interface Services {
  node: NodeService;
  project: ProjectService;
}

const Ctx = createContext<Services | null>(null);

export function AppProvider({ children, services }: { children: ReactNode; services: Services }) {
  return <Ctx.Provider value={services}>{children}</Ctx.Provider>;
}

export function useServices(): Services {
  const value = useContext(Ctx);
  if (!value) throw new Error('AppProvider missing');
  return value;
}
