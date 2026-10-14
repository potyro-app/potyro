// The GitHub half of the relay: issues in one repository, through the REST API, with a token held
// on the server (docs/16). Nothing else about GitHub is reachable from here.

import type { Issue, IssueTracker } from "./relay.ts";

export interface GitHubOptions {
  /** A fine-grained token with Issues: read and write on the one repository, and nothing else. */
  token: string;
  /** "owner/name". */
  repo: string;
  fetch?: typeof fetch;
  api?: string;
}

interface RawIssue {
  number: number;
  title: string;
  html_url: string;
  pull_request?: unknown;
}

export function githubIssues(opts: GitHubOptions): IssueTracker {
  if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) throw new Error(`not a repository: ${opts.repo}`);
  const get = opts.fetch ?? fetch;
  const api = opts.api ?? "https://api.github.com";
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await get(`${api}/repos/${opts.repo}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${opts.token}`,
        "user-agent": "potyro-platform-requests",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  const issue = (r: RawIssue): Issue => ({ number: r.number, title: r.title, url: r.html_url });
  return {
    // One page of 100: the open requests the team has not triaged. Past that, a duplicate is filed
    // as a new issue rather than grouped — a cost, not a failure.
    listOpen: async (label) =>
      ((await call("GET", `/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`)) as RawIssue[]).filter((r) => !r.pull_request).map(issue),
    create: async (i) => issue((await call("POST", "/issues", i)) as RawIssue),
    comment: async (number, body) => void (await call("POST", `/issues/${number}/comments`, { body })),
  };
}
