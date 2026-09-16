import { configDefaults, defineConfig } from "vitest/config";

// Without this, vitest's default glob picks up every `.worktrees/*` checkout
// alongside the real repo, so the reported file/test count tracks how many
// worktrees exist locally rather than the codebase. `.worktrees/` is
// gitignored and never present in CI, so this only changes local behavior.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".worktrees/**"],
  },
});
