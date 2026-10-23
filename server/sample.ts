import type { Environment } from '../shared/constants.js';
import { insertBookmark, insertGroup, insertWorkspace, setMeta } from './repo.js';
import type { Executor as DB } from './db/types.js';

interface SB {
  title: string;
  url: string;
  description: string;
  environment: Environment;
  owner?: string;
  icon: string;
  tags: string[];
  favorite?: boolean;
  note?: string;
}
interface SG { name: string; bookmarks: SB[] }
interface SW { name: string; icon: string; groups: SG[] }

/** Clearly fictional content: every address lives under reserved example domains (RFC 2606). */
export const SAMPLE_DATA: SW[] = [
  {
    name: 'Daily Operations',
    icon: 'layout-dashboard',
    groups: [
      {
        name: 'Incident response',
        bookmarks: [
          { title: 'Ticketing', url: 'https://tickets.example.org/queues/ops', description: 'Sample: ticket queue for operations requests.', environment: 'production', owner: 'Service Desk', icon: 'ticket', tags: ['tickets', 'incident'], favorite: true },
          { title: 'Infrastructure management', url: 'https://infra.example.org/', description: 'Sample: inventory and change calendar.', environment: 'production', owner: 'Infrastructure', icon: 'server', tags: ['inventory', 'changes'] },
          { title: 'Status page (internal)', url: 'https://status.example.org/', description: 'Sample: internal communication during incidents.', environment: 'production', owner: 'Service Desk', icon: 'siren', tags: ['incident', 'communication'] },
        ],
      },
      {
        name: 'Shortcuts',
        bookmarks: [
          { title: 'On-call schedule', url: 'https://oncall.example.org/schedule', description: 'Sample: who is on call this week.', environment: 'other', owner: 'N2 Support', icon: 'calendar', tags: ['on-call'] },
        ],
      },
    ],
  },
  {
    name: 'Observability',
    icon: 'activity',
    groups: [
      {
        name: 'Elastic Stack',
        bookmarks: [
          { title: 'Kibana', url: 'https://kibana.example.org:5601/app/discover', description: 'Sample: log exploration (production).', environment: 'production', owner: 'Observability', icon: 'search', tags: ['elastic', 'logs'], favorite: true, note: 'Sample note: start with the "ops-logs-*" data view.' },
          { title: 'Kibana (preproduction)', url: 'https://kibana-preprod.example.org:5601/app/discover', description: 'Sample: log exploration (preproduction).', environment: 'preproduction', owner: 'Observability', icon: 'search', tags: ['elastic', 'logs'] },
          { title: 'APM', url: 'https://kibana.example.org:5601/app/apm', description: 'Sample: application performance monitoring.', environment: 'production', owner: 'Observability', icon: 'gauge', tags: ['elastic', 'apm', 'tracing'] },
          { title: 'Elasticsearch documentation', url: 'https://docs.example.org/elasticsearch/', description: 'Sample: placeholder for the reference documentation.', environment: 'other', owner: '', icon: 'book-open', tags: ['elastic', 'docs'] },
        ],
      },
      {
        name: 'Metrics',
        bookmarks: [
          { title: 'Grafana', url: 'https://grafana.example.org/dashboards', description: 'Sample: metrics dashboards.', environment: 'production', owner: 'Observability', icon: 'chart-line', tags: ['metrics', 'dashboards'], favorite: true },
          { title: 'Prometheus', url: 'https://prometheus.example.org:9090/graph', description: 'Sample: query console and targets.', environment: 'production', owner: 'Observability', icon: 'flame', tags: ['metrics', 'alerts'] },
        ],
      },
    ],
  },
  {
    name: 'Infrastructure',
    icon: 'server',
    groups: [
      {
        name: 'Platform',
        bookmarks: [
          { title: 'Infrastructure management (lab)', url: 'https://infra-lab.example.net:8443/', description: 'Sample: lab environment console.', environment: 'lab', owner: 'Infrastructure', icon: 'hard-drive', tags: ['inventory'] },
          { title: 'Virtualisation console', url: 'https://virt.example.net/ui', description: 'Sample: hypervisor management.', environment: 'development', owner: 'Infrastructure', icon: 'cpu', tags: ['virtualisation'] },
        ],
      },
    ],
  },
  {
    name: 'Delivery & Automation',
    icon: 'rocket',
    groups: [
      {
        name: 'CI/CD',
        bookmarks: [
          { title: 'GitLab', url: 'https://gitlab.example.org/', description: 'Sample: source code and merge requests.', environment: 'production', owner: 'Delivery', icon: 'git-branch', tags: ['git', 'ci'] },
          { title: 'Jenkins', url: 'https://jenkins.example.org:8080/', description: 'Sample: build and deployment jobs.', environment: 'staging', owner: 'Delivery', icon: 'workflow', tags: ['ci', 'deploy'] },
        ],
      },
      {
        name: 'Automation',
        bookmarks: [
          { title: 'Ansible / AWX', url: 'https://awx.example.org/#/templates', description: 'Sample: job templates and inventories.', environment: 'production', owner: 'Automation', icon: 'wrench', tags: ['ansible', 'automation'] },
        ],
      },
    ],
  },
  {
    name: 'N2/N3 Resources',
    icon: 'life-buoy',
    groups: [
      {
        name: 'Runbooks & documentation',
        bookmarks: [
          { title: 'N2 runbooks', url: 'https://wiki.example.org/n2/runbooks', description: 'Sample: first-line technical procedures.', environment: 'other', owner: 'N2 Support', icon: 'clipboard-list', tags: ['runbook', 'n2'], favorite: true },
          { title: 'N3 troubleshooting documentation', url: 'https://wiki.example.org/n3/troubleshooting', description: 'Sample: deep-dive troubleshooting guides.', environment: 'other', owner: 'N3 Support', icon: 'bug', tags: ['troubleshooting', 'n3'] },
          { title: 'N2 to N3 escalation guide', url: 'https://wiki.example.org/escalation', description: 'Sample: when and how to escalate.', environment: 'other', owner: 'N3 Support', icon: 'file-text', tags: ['escalation', 'n2', 'n3'] },
        ],
      },
    ],
  },
];

export async function insertSampleData(db: DB): Promise<void> {
  await db.transaction(async (tx) => {
    for (const w of SAMPLE_DATA) {
      const wid = await insertWorkspace(tx, { name: w.name, icon: w.icon, isSample: true });
      for (const g of w.groups) {
        const gid = await insertGroup(tx, wid, { name: g.name, isSample: true });
        for (const b of g.bookmarks) {
          await insertBookmark(tx, gid, { ...b, owner: b.owner ?? '', note: b.note ?? '' }, { isSample: true });
        }
      }
    }
  });
}

/** One-time first-run choice. Once 'done', sample content is never inserted again. */
export async function completeSetup(db: DB, choice: 'sample' | 'empty'): Promise<void> {
  await db.transaction(async (tx) => {
    if (choice === 'sample') await insertSampleData(tx);
    await setMeta(tx, 'setup', 'done');
  });
}
