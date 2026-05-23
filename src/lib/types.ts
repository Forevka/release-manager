// TypeScript mirror of the rm-core IPC contract. Keep in sync with
// src-tauri/crates/core/src/lib.rs.

export type Health = {
  appName: string;
  appVersion: string;
  core: {
    crateName: string;
    crateVersion: string;
  };
};

export type JiraConnection = {
  url: string;
  email: string;
  /** True if a token is in the OS keychain. Never the value itself. */
  tokenSet: boolean;
};

export type GitLabConnection = {
  url: string;
  tokenSet: boolean;
};

export type ProjectGroup = {
  id: string;
  name: string;
  jiraProjectKey: string | null;
  defaultReleaseBranch: string;
  defaultProdBranch: string;
  gitTimeoutSeconds: number;
  maxRetries: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type NewProjectGroup = {
  name: string;
  jiraProjectKey: string | null;
  defaultReleaseBranch: string;
  defaultProdBranch: string;
  gitTimeoutSeconds: number;
  maxRetries: number;
};

export type Repository = {
  id: string;
  groupId: string;
  name: string;
  path: string;
  releaseBranch: string | null;
  prodBranch: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type NewRepository = {
  groupId: string;
  name: string;
  path: string;
  releaseBranch: string | null;
  prodBranch: string | null;
};

// ---------- Jira ----------

export type JiraVersion = {
  id: string;
  name: string;
  released: boolean;
  archived: boolean;
  description: string | null;
  releaseDate: string | null;
};

export type JiraIssue = {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
};

// ---------- release check ----------

export type BranchVerdict =
  | "merged"
  | "not-merged"
  | "not-found"
  | "target-missing"
  | "error";

export type BranchCell = {
  repoId: string;
  ticketKey: string;
  verdict: BranchVerdict;
  resolvedBranch: string | null;
  commitsBehind: number | null;
  note: string | null;
  /** True only if the repo is mid-merge (MERGE_HEAD present). */
  mergeInProgress: boolean;
};

export type ReleaseCheckResult = {
  groupId: string;
  versionName: string;
  tickets: JiraIssue[];
  cells: BranchCell[];
  checkedAt: string;
};

export type RepoFetchResult = {
  repoId: string;
  success: boolean;
  error: string | null;
};

// ---------- GitLab (phase 9) ----------

export type GitLabProject = {
  id: number;
  /** Last path segment, e.g. "atlas". */
  path: string;
  /** Full GitLab path, e.g. "devcom/atlas". */
  pathWithNamespace: string;
  name: string;
  defaultBranch: string | null;
  sshUrlToRepo: string;
  httpUrlToRepo: string;
  webUrl: string;
  archived: boolean;
};

// ---------- changelog ----------

export type TagInfo = {
  name: string;
  date: number | null;
};

export type CommitEntry = {
  sha: string;
  subject: string;
  authorEmail: string;
  repoName: string;
  ticketKey: string | null;
  commitType: string;
  breaking: boolean;
};

export type ChangelogSection = {
  title: string;
  entries: CommitEntry[];
};

export type ChangelogStats = {
  totalAnalyzed: number;
  totalIncluded: number;
  byType: [string, number][];
  byRepo: [string, number][];
};

export type ChangelogResult = {
  version: string;
  sections: ChangelogSection[];
  stats: ChangelogStats;
  markdown: string;
};

export type RepoTagOverride = {
  repoId: string;
  tag: string | null;
};

export type ChangelogRange =
  | { kind: "tags"; fromTag: string; toTag: string }
  | { kind: "dates"; since: string; until: string | null };

// ---------- branch tags ----------

export type BranchTagKind = "broken" | "not-needed" | "obsolete" | "wip";

export type BranchTag = {
  repoId: string;
  branchName: string;
  kind: BranchTagKind;
  note: string | null;
  updatedAt: string;
};

// ---------- merge outcomes (phase 4) ----------

export type MergeOutcome =
  | { kind: "success"; commit: string }
  | { kind: "conflict"; message: string }
  | { kind: "dirty-working-tree"; message: string }
  | { kind: "failed"; message: string };
