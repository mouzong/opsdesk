import { describe, expect, it } from 'vitest';
import { applyFilters, collectTags, EMPTY_FILTERS, type FilterState } from './search.js';
import type { Bookmark, Dashboard } from './types.js';

const bm = (id: string, o: Partial<Bookmark>): Bookmark => ({
  id, groupId: 'g', title: id, url: `https://${id}.example.org/`, description: '', environment: 'other', owner: '',
  icon: null, tags: [], favorite: false, note: '', isSample: false, createdAt: '', updatedAt: '', lastOpenedAt: null, openCount: 0, ...o,
});
const d: Dashboard = {
  title: 't', setup: 'done', recent: [],
  workspaces: [
    { id: 'w1', name: 'One', icon: 'link', isSample: false, groups: [
      { id: 'g1', workspaceId: 'w1', name: 'G1', collapsed: false, isSample: false, bookmarks: [
        bm('kibana', { title: 'Kibana', environment: 'production', tags: ['elastic', 'logs'], owner: 'Observability', favorite: true }),
        bm('kibana-pre', { title: 'Kibana Pre', environment: 'preproduction', tags: ['elastic'], description: 'Log search' }),
      ] },
      { id: 'g2', workspaceId: 'w1', name: 'G2', collapsed: false, isSample: false, bookmarks: [bm('grafana', { title: 'Grafana', tags: ['metrics'], environment: 'production' })] },
    ] },
    { id: 'w2', name: 'Two', icon: 'link', isSample: false, groups: [
      { id: 'g3', workspaceId: 'w2', name: 'G3', collapsed: false, isSample: false, bookmarks: [bm('awx', { title: 'AWX', owner: 'Automation Team', url: 'https://awx.corp.example:8443/#/jobs' })] },
    ] },
  ],
};
const f = (o: Partial<FilterState>): FilterState => ({ ...EMPTY_FILTERS, ...o });
const ids = (ws: ReturnType<typeof applyFilters>) => ws.flatMap((w) => w.groups.flatMap((g) => g.bookmarks.map((b) => b.id)));

describe('search and filters', () => {
  it('shows only the current workspace without criteria', () => {
    expect(ids(applyFilters(d, f({}), 'w1'))).toEqual(['kibana', 'kibana-pre', 'grafana']);
  });
  it('is case-insensitive and spans title, description, url, tags and owner', () => {
    expect(ids(applyFilters(d, f({ query: 'KIBANA' }), 'w1'))).toEqual(['kibana', 'kibana-pre']);
    expect(ids(applyFilters(d, f({ query: 'log search' }), 'w1'))).toEqual(['kibana-pre']);
    expect(ids(applyFilters(d, f({ query: 'metrics' }), 'w1'))).toEqual(['grafana']);
    expect(ids(applyFilters(d, f({ query: 'observability' }), 'w1'))).toEqual(['kibana']);
    expect(ids(applyFilters(d, f({ query: ':8443/#/jobs', scope: 'all' }), 'w1'))).toEqual(['awx']);
  });
  it('scope decides whether other workspaces are searched', () => {
    expect(ids(applyFilters(d, f({ query: 'awx' }), 'w1'))).toEqual([]);
    expect(ids(applyFilters(d, f({ query: 'awx', scope: 'all' }), 'w1'))).toEqual(['awx']);
  });
  it('combines query, environment (any), tags (all) and favorites with AND', () => {
    expect(ids(applyFilters(d, f({ query: 'kibana', environments: ['production'] }), 'w1'))).toEqual(['kibana']);
    expect(ids(applyFilters(d, f({ environments: ['production', 'preproduction'] }), 'w1'))).toEqual(['kibana', 'kibana-pre', 'grafana']);
    expect(ids(applyFilters(d, f({ tags: ['elastic', 'logs'] }), 'w1'))).toEqual(['kibana']);
    expect(ids(applyFilters(d, f({ tags: ['ELASTIC'] }), 'w1'))).toEqual(['kibana', 'kibana-pre']);
    expect(ids(applyFilters(d, f({ favoritesOnly: true, scope: 'all' }), 'w1'))).toEqual(['kibana']);
    expect(ids(applyFilters(d, f({ favoritesOnly: true, environments: ['preproduction'] }), 'w1'))).toEqual([]);
    expect(ids(applyFilters(d, f({ query: 'elastic kibana pre' }), 'w1'))).toEqual(['kibana-pre']);
  });
  it('drops empty groups and collects tag counts', () => {
    const r = applyFilters(d, f({ query: 'grafana' }), 'w1');
    expect(r).toHaveLength(1);
    expect(r[0]!.groups.map((g) => g.id)).toEqual(['g2']);
    expect(collectTags(d.workspaces)[0]).toEqual({ tag: 'elastic', count: 2 });
  });
});
