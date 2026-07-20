import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyTitle,
  checkReleaseImpact,
} from "../.github/scripts/check-release-impact.mjs";

function pullRequest(title, labels = [], head = "feature") {
  return {
    title,
    labels: labels.map((name) => ({ name })),
    head: { ref: head },
  };
}

test("classifies conventional PR titles", () => {
  assert.equal(classifyTitle("docs: update setup"), "release:none");
  assert.equal(classifyTitle("fix(popup): handle empty tabs"), "release:patch");
  assert.equal(classifyTitle("perf: reduce comparisons"), "release:patch");
  assert.equal(classifyTitle("feat: add tab search"), "release:minor");
  assert.equal(classifyTitle("feat!: replace storage format"), "release:major");
});

test("requires exactly one impact label", () => {
  assert.throws(
    () => checkReleaseImpact(pullRequest("fix: handle empty tabs")),
    /Select exactly one release impact label/,
  );
  assert.throws(
    () =>
      checkReleaseImpact(
        pullRequest("fix: handle empty tabs", [
          "release:patch",
          "release:minor",
        ]),
      ),
    /Select exactly one release impact label/,
  );
});

test("requires the label to match the PR title", () => {
  assert.throws(
    () =>
      checkReleaseImpact(
        pullRequest("feat: add tab search", ["release:patch"]),
      ),
    /title implies release:minor/,
  );
  assert.equal(
    checkReleaseImpact(
      pullRequest("feat: add tab search", ["release:minor"]),
    ),
    "release:minor matches the PR title.",
  );
});

test("allows generated Release Please PRs", () => {
  assert.match(
    checkReleaseImpact(
      pullRequest(
        "chore(main): release 2.1.0",
        [],
        "release-please--branches--main",
      ),
    ),
    /managed automatically/,
  );
});
