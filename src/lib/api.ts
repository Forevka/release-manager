// Typed wrappers around Tauri's `invoke`. One function per backend command.
// Keep the signatures aligned with the #[tauri::command] definitions in
// src-tauri/src/commands/.

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type {
  BranchCell,
  BranchTag,
  BranchTagKind,
  ChangelogRange,
  ChangelogResult,
  GitLabConnection,
  GitLabProject,
  Health,
  JiraConnection,
  JiraVersion,
  MergeOutcome,
  NewProjectGroup,
  NewRepository,
  ProjectGroup,
  ReleaseCheckResult,
  RepoFetchResult,
  RepoTagOverride,
  Repository,
  TagInfo,
} from "./types";

// ---------- health ----------

export const ping = () => invoke<Health>("ping");

// ---------- connections (Jira / GitLab) ----------

export const getJiraConnection = () =>
  invoke<JiraConnection>("get_jira_connection");

export const saveJiraConnection = (input: {
  url: string;
  email: string;
  /** undefined leaves existing token untouched; "" deletes it. */
  token?: string;
}) => invoke<JiraConnection>("save_jira_connection", input);

export const getGitLabConnection = () =>
  invoke<GitLabConnection>("get_gitlab_connection");

export const saveGitLabConnection = (input: {
  url: string;
  token?: string;
}) => invoke<GitLabConnection>("save_gitlab_connection", input);

// ---------- project groups ----------

export const listGroups = () => invoke<ProjectGroup[]>("list_groups");

export const createGroup = (input: NewProjectGroup) =>
  invoke<ProjectGroup>("create_group", { input });

export const updateGroup = (id: string, input: NewProjectGroup) =>
  invoke<ProjectGroup>("update_group", { id, input });

export const deleteGroup = (id: string) =>
  invoke<void>("delete_group", { id });

// ---------- repositories ----------

export const listRepositories = (groupId: string) =>
  invoke<Repository[]>("list_repositories", { groupId });

export const createRepository = (input: NewRepository) =>
  invoke<Repository>("create_repository", { input });

export const updateRepository = (id: string, input: NewRepository) =>
  invoke<Repository>("update_repository", { id, input });

export const deleteRepository = (id: string) =>
  invoke<void>("delete_repository", { id });

// ---------- releases (phase 3) ----------

export const listJiraVersions = (groupId: string) =>
  invoke<JiraVersion[]>("list_jira_versions", { groupId });

export const checkRelease = (
  groupId: string,
  versionName: string,
  taskId?: string,
) => invoke<ReleaseCheckResult>("check_release", { groupId, versionName, taskId });

export const fetchRepos = (groupId: string, taskId?: string) =>
  invoke<RepoFetchResult[]>("fetch_repos", { groupId, taskId });

// ---------- watcher + per-repo recheck (phase 8) ----------

export const watchGroupRepos = (groupId: string) =>
  invoke<void>("watch_group_repos", { groupId });

export const clearWatchedRepos = () => invoke<void>("clear_watched_repos");

export const recheckRepoCells = (
  groupId: string,
  repoId: string,
  ticketKeys: string[],
) =>
  invoke<BranchCell[]>("recheck_repo_cells", {
    groupId,
    repoId,
    ticketKeys,
  });

// ---------- merges (phase 4) ----------

export const mergeBranch = (repoId: string, source: string) =>
  invoke<MergeOutcome>("merge_branch", { repoId, source });

export const openInExplorer = (repoId: string) =>
  invoke<void>("open_in_explorer", { repoId });

export const openInMergeTool = (repoId: string) =>
  invoke<void>("open_in_merge_tool", { repoId });

export const getExternalMergeTool = () =>
  invoke<string>("get_external_merge_tool");

export const saveExternalMergeTool = (value: string) =>
  invoke<string>("save_external_merge_tool", { value });

// ---------- changelog ----------

export const listGroupTags = (groupId: string) =>
  invoke<TagInfo[]>("list_group_tags", { groupId });

export const generateChangelog = (input: {
  groupId: string;
  range: ChangelogRange;
  version: string;
  tagOverrides: RepoTagOverride[];
}) => invoke<ChangelogResult>("generate_changelog", input);

// ---------- branch tags ----------

export const listBranchTags = (repoId: string) =>
  invoke<BranchTag[]>("list_branch_tags", { repoId });

export const setBranchTag = (
  repoId: string,
  branchName: string,
  kind: BranchTagKind | null,
  note?: string,
) => invoke<BranchTag | null>("set_branch_tag", { repoId, branchName, kind, note });

// ---------- GitLab discovery (phase 9) ----------

export const listGitlabGroupProjects = (
  groupPath: string,
  includeSubgroups = true,
) =>
  invoke<GitLabProject[]>("list_gitlab_group_projects", {
    groupPath,
    includeSubgroups,
  });

export const detectLocalClone = (baseDir: string, projectPath: string) =>
  invoke<string | null>("detect_local_clone", { baseDir, projectPath });

export const cloneProject = (url: string, targetPath: string) =>
  invoke<{ targetPath: string }>("clone_project", { url, targetPath });

// ---------- dialogs ----------

/** Returns the picked directory path, or null if the user cancelled. */
export const pickDirectory = async (
  title = "Select repository folder",
): Promise<string | null> => {
  const selected = await open({ directory: true, multiple: false, title });
  if (Array.isArray(selected)) return selected[0] ?? null;
  return selected ?? null;
};
