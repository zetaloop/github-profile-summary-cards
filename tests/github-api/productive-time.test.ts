import {getProductiveTime} from '../../src/github-api/productive-time';
import {getCache} from '@vercel/functions';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

jest.mock('@vercel/functions', () => ({getCache: jest.fn()}));

const mock = new MockAdapter(axios);

afterEach(() => mock.reset());

it('reuses unchanged histories and replaces rewritten histories after all pages succeed', async () => {
    let snapshot: unknown = null;
    const cache = {
        get: jest.fn(async () => structuredClone(snapshot)),
        set: jest.fn(async (_key: string, value: unknown) => {
            snapshot = structuredClone(value);
        })
    };
    (getCache as jest.Mock).mockReturnValue(cache);
    const createdAt = `${new Date().getUTCFullYear()}-01-01T00:00:00Z`;
    const early = '2020-01-01T00:00:00.000Z';
    const recent = '2025-06-01T12:00:00.000Z';
    const rewritten = '2025-07-01T08:00:00.000Z';
    const heads: Record<string, string> = {owned: 'old', fork: 'fork-head', external: 'external-head'};
    let historyRequests = 0;
    let phase = 'initial';
    let page = 0;
    const history = (nodes: {oid: string; authoredDate: string}[], next = false) => ({
        object: {history: {nodes, pageInfo: {hasNextPage: next, endCursor: next ? 'cursor' : null}}}
    });
    mock.onPost('https://api.github.com/graphql').reply(config => {
        const {query, variables} = JSON.parse(config.data);
        if (query.includes('query ProductiveTimeRepositories')) {
            return [
                200,
                {
                    data: {
                        user: {
                            id: 'user',
                            createdAt,
                            repositories: {
                                nodes: [{id: variables.after ? 'fork' : 'owned'}],
                                pageInfo: {hasNextPage: !variables.after, endCursor: 'owned-cursor'}
                            }
                        }
                    }
                }
            ];
        }
        if (query.includes('query ProductiveTimeContributions')) {
            return [
                200,
                {
                    data: {
                        user: {
                            w0: {
                                totalRepositoriesWithContributedCommits: heads.external ? 1 : 0,
                                commitContributionsByRepository: heads.external ? [{repository: {id: 'external'}}] : []
                            }
                        }
                    }
                }
            ];
        }
        if (query.includes('query ProductiveTimeHeads')) {
            return [
                200,
                {
                    data: {
                        nodes: variables.ids.map((id: string) => (heads[id] ? {id, object: {oid: heads[id]}} : null))
                    },
                    errors: heads.external ? [] : [{type: 'NOT_FOUND', path: ['nodes', 2]}]
                }
            ];
        }
        if (query.includes('query ProductiveTimeHistory')) {
            historyRequests += 1;
            if (phase === 'initial') {
                expect(query).toContain('object(oid: "old")');
                if (page++ === 0) {
                    return [
                        200,
                        {
                            data: {
                                r0: history([{oid: 'shared', authoredDate: early}], true),
                                r1: history([{oid: 'shared', authoredDate: early}]),
                                r2: history([{oid: 'external-commit', authoredDate: recent}])
                            }
                        }
                    ];
                }
                expect(query).toContain('after: "cursor"');
                return [200, {data: {r0: history([{oid: 'removed', authoredDate: recent}])}}];
            }
            expect(query).toContain('node(id: "owned")');
            expect(query).not.toContain('node(id: "fork")');
            if (phase === 'rewrite') {
                expect(query).toContain('object(oid: "rewritten")');
                return [200, {data: {r0: history([{oid: 'replacement', authoredDate: rewritten}])}}];
            }
            if (page++ === 0) return [200, {data: {r0: history([{oid: 'partial', authoredDate: early}], true)}}];
            return [200, {errors: [{message: 'History unavailable'}]}];
        }
        throw Error('Unexpected GitHub operation');
    });

    const initial = await getProductiveTime('user', 'token');
    expect(initial.productiveDate.map(date => date.toISOString()).sort()).toEqual([early, recent, recent]);
    expect(historyRequests).toBe(2);

    const unchanged = await getProductiveTime('user', 'token');
    expect(unchanged).toEqual(initial);
    expect(historyRequests).toBe(2);

    phase = 'rewrite';
    heads.owned = 'rewritten';
    delete heads.external;
    const updated = await getProductiveTime('user', 'token');
    expect(updated.productiveDate.map(date => date.toISOString()).sort()).toEqual([early, rewritten]);
    expect(historyRequests).toBe(3);

    const saved = structuredClone(snapshot);
    const writes = cache.set.mock.calls.length;
    phase = 'failure';
    page = 0;
    heads.owned = 'incomplete';
    await expect(getProductiveTime('user', 'token')).rejects.toThrow('History unavailable');
    expect(cache.set).toHaveBeenCalledTimes(writes);
    expect(snapshot).toEqual(saved);
});
