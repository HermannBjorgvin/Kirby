export type ActiveTab = 'sessions' | 'reviews';

export type Focus = 'sidebar' | 'terminal';

export interface AgentSession {
  name: string;
  running: boolean;
}
