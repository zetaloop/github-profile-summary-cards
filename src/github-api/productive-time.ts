import {getCache} from '@vercel/functions';
import request, {assertNoGraphQLErrors} from '../utils/request';
import {coalesce} from '../utils/data-cache';

export class ProfuctiveTime {
    productiveDate: Date[] = [];

    public addProductiveDate(date: Date) {
        this.productiveDate.push(date);
    }
}

interface PageInfo {
    hasNextPage: boolean;
    endCursor: string | null;
}

interface UserRepositories {
    id: string;
    createdAt: string;
    repositories: {nodes: {id: string}[]; pageInfo: PageInfo};
}

interface RepositoryHistory {
    head: string | null;
    commits: [string, string][];
}

interface Snapshot {
    userId: string;
    createdAt: string;
    repositories: Record<string, RepositoryHistory>;
}

interface ContributionWindow {
    totalRepositoriesWithContributedCommits: number;
    commitContributionsByRepository: {repository: {id: string}}[];
}

async function query<T>(token: string, document: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await request({Authorization: `bearer ${token}`}, {query: document, variables});
    assertNoGraphQLErrors(res, 'GetProductiveTime failed');
    return res.data.data as T;
}

async function getRepositories(username: string, token: string) {
    const ids: string[] = [];
    let cursor: string | null = null;
    while (true) {
        const data: {user: UserRepositories} = await query(
            token,
            `query ProductiveTimeRepositories($login: String!, $after: String) {
                user(login: $login) {
                    id
                    createdAt
                    repositories(first: 100, after: $after, ownerAffiliations: OWNER) {
                        nodes { id }
                        pageInfo { hasNextPage endCursor }
                    }
                }
            }`,
            {login: username, after: cursor}
        );
        const repos = data.user.repositories;
        ids.push(...repos.nodes.map(repo => repo.id));
        if (!repos.pageInfo.hasNextPage) {
            return {userId: data.user.id, createdAt: data.user.createdAt, ids};
        }
        cursor = repos.pageInfo.endCursor;
    }
}

async function getContributedRepositories(username: string, createdAt: string, token: string): Promise<string[]> {
    const ids = new Set<string>();
    let windows: {from: number; to: number}[] = [];
    for (let year = new Date(createdAt).getUTCFullYear(); year <= new Date().getUTCFullYear(); year++) {
        windows.push({from: Date.UTC(year, 0, 1), to: Date.UTC(year + 1, 0, 1) - 1});
    }
    while (windows.length) {
        const fields = windows.map(
            ({from, to}, i) => `w${i}: contributionsCollection(
                from: "${new Date(from).toISOString()}", to: "${new Date(to).toISOString()}"
            ) {
                totalRepositoriesWithContributedCommits
                commitContributionsByRepository(maxRepositories: 100) { repository { id } }
            }`
        );
        const data = await query<{user: Record<string, ContributionWindow>}>(
            token,
            `query ProductiveTimeContributions($login: String!) { user(login: $login) { ${fields.join('\n')} } }`,
            {login: username}
        );
        const remaining: typeof windows = [];
        windows.forEach((window, i) => {
            const result = data.user[`w${i}`];
            for (const contribution of result.commitContributionsByRepository) {
                ids.add(contribution.repository.id);
            }
            // This connection has no cursor; smaller date windows expose the remaining repositories.
            if (result.commitContributionsByRepository.length < result.totalRepositoriesWithContributedCommits) {
                const middle = Math.floor((window.from + window.to) / 2);
                if (middle === window.from) throw Error('GitHub returned an incomplete contribution repository list');
                remaining.push({from: window.from, to: middle}, {from: middle + 1, to: window.to});
            }
        });
        windows = remaining;
    }
    return [...ids];
}

async function getHeads(ids: string[], token: string): Promise<Map<string, string | null>> {
    const heads = new Map<string, string | null>();
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
    await Promise.all(
        batches.map(async batch => {
            const res = await request(
                {Authorization: `bearer ${token}`},
                {
                    query: `query ProductiveTimeHeads($ids: [ID!]!) {
                        nodes(ids: $ids) { ... on Repository { id object(expression: "HEAD") { oid } } }
                    }`,
                    variables: {ids: batch}
                }
            );
            // A cached repository can have been deleted or become inaccessible.
            const errors = res.data.errors?.filter((error: {type?: string}) => error.type !== 'NOT_FOUND');
            assertNoGraphQLErrors({data: {errors}}, 'GetProductiveTime failed');
            for (const repo of res.data.data.nodes as ({id: string; object: {oid: string} | null} | null)[]) {
                if (repo) heads.set(repo.id, repo.object?.oid ?? null);
            }
        })
    );
    return heads;
}

async function getHistories(
    heads: [string, string][],
    userId: string,
    token: string
): Promise<Record<string, RepositoryHistory>> {
    const repositories: Record<string, RepositoryHistory> = {};
    let pending = heads.map(([id, head]) => ({id, head, cursor: null as string | null}));
    heads.forEach(([id, head]) => {
        repositories[id] = {head, commits: []};
    });
    while (pending.length) {
        const nextPages: typeof pending = [];
        for (let i = 0; i < pending.length; i += 30) {
            const batches = [];
            for (let j = i; j < Math.min(i + 30, pending.length); j += 10) {
                batches.push(pending.slice(j, j + 10));
            }
            const results = await Promise.all(
                batches.map(async batch => {
                    // Pin every page to the observed commit, even if the branch advances during the request.
                    const fields = batch.map(
                        ({id, head, cursor}, index) => `r${index}: node(id: ${JSON.stringify(id)}) {
                            ... on Repository {
                                object(oid: ${JSON.stringify(head)}) {
                                    ... on Commit {
                                        history(first: 100, after: ${JSON.stringify(cursor)}, author: {id: $userId}) {
                                            nodes { oid authoredDate }
                                            pageInfo { hasNextPage endCursor }
                                        }
                                    }
                                }
                            }
                        }`
                    );
                    const data = await query<
                        Record<
                            string,
                            {object: {history: {nodes: {oid: string; authoredDate: string}[]; pageInfo: PageInfo}}}
                        >
                    >(token, `query ProductiveTimeHistory($userId: ID!) { ${fields.join('\n')} }`, {userId});
                    return batch.filter((repo, index) => {
                        const history = data[`r${index}`].object.history;
                        for (const commit of history.nodes) {
                            repositories[repo.id].commits.push([commit.oid, commit.authoredDate]);
                        }
                        repo.cursor = history.pageInfo.endCursor;
                        return history.pageInfo.hasNextPage;
                    });
                })
            );
            nextPages.push(...results.flat());
        }
        pending = nextPages;
    }
    return repositories;
}

// Repository heads determine freshness; cached commit records survive date and theme changes.
export async function getProductiveTime(username: string, token: string): Promise<ProfuctiveTime> {
    const key = username.toLowerCase();
    return coalesce(`productive-time:${key}`, async () => {
        const cache = getCache({namespace: 'github-profile-summary-cards:productive-time'});
        const previous = (await cache.get(key)) as Snapshot | null;
        const ownedPromise = getRepositories(username, token);
        const contributedPromise = (previous ? Promise.resolve(previous) : ownedPromise).then(({createdAt}) =>
            getContributedRepositories(username, createdAt, token)
        );
        const [owned, contributed, heads] = await Promise.all([
            ownedPromise,
            contributedPromise,
            getHeads(Object.keys(previous?.repositories ?? {}), token)
        ]);
        const ids = new Set([...owned.ids, ...contributed]);
        const missing = [...ids].filter(id => !(id in (previous?.repositories ?? {})));
        for (const [id, head] of await getHeads(missing, token)) heads.set(id, head);

        const repositories: Record<string, RepositoryHistory> = {};
        const changed: [string, string][] = [];
        for (const id of ids) {
            if (!heads.has(id)) continue;
            const head = heads.get(id)!;
            const cached = previous && previous.userId === owned.userId ? previous.repositories[id] : undefined;
            if (cached?.head === head) {
                repositories[id] = cached;
            } else if (head === null) {
                repositories[id] = {head, commits: []};
            } else {
                changed.push([id, head]);
            }
        }
        Object.assign(repositories, await getHistories(changed, owned.userId, token));
        await cache.set(key, {userId: owned.userId, createdAt: owned.createdAt, repositories});
        console.log(`productive-time: refreshed ${changed.length} of ${ids.size} repository histories`);

        const commits = new Map(Object.values(repositories).flatMap(repo => repo.commits));
        const productiveTime = new ProfuctiveTime();
        commits.forEach(date => productiveTime.addProductiveDate(new Date(date)));
        return productiveTime;
    });
}
