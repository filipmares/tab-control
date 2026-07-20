import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const IMPACT_LABELS = [
  "release:none",
  "release:patch",
  "release:minor",
  "release:major",
];

const NO_RELEASE_TYPES = new Set([
  "build",
  "chore",
  "ci",
  "docs",
  "refactor",
  "style",
  "test",
]);

export function classifyTitle(title) {
  const match = /^(?<type>[a-z][a-z0-9-]*)(?:\([^)]+\))?(?<breaking>!)?: .+/.exec(
    title,
  );

  if (!match) {
    throw new Error(
      "PR title must use Conventional Commits, for example: fix: handle empty windows",
    );
  }

  if (match.groups.breaking) {
    return "release:major";
  }

  if (match.groups.type === "feat") {
    return "release:minor";
  }

  if (match.groups.type === "fix" || match.groups.type === "perf") {
    return "release:patch";
  }

  if (NO_RELEASE_TYPES.has(match.groups.type)) {
    return "release:none";
  }

  throw new Error(
    `PR title type "${match.groups.type}" is not mapped to a release impact`,
  );
}

export function checkReleaseImpact(pullRequest) {
  if (pullRequest.head.ref.startsWith("release-please--")) {
    return "Release Please PRs are managed automatically.";
  }

  const selectedLabels = pullRequest.labels
    .map(({ name }) => name)
    .filter((name) => IMPACT_LABELS.includes(name));

  if (selectedLabels.length !== 1) {
    throw new Error(
      `Select exactly one release impact label: ${IMPACT_LABELS.join(", ")}`,
    );
  }

  const expectedLabel = classifyTitle(pullRequest.title);
  const selectedLabel = selectedLabels[0];

  if (selectedLabel !== expectedLabel) {
    throw new Error(
      `PR title implies ${expectedLabel}, but ${selectedLabel} is selected`,
    );
  }

  return `${selectedLabel} matches the PR title.`;
}

function main(eventPath) {
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  console.log(checkReleaseImpact(event.pull_request));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2] ?? process.env.GITHUB_EVENT_PATH);
}
