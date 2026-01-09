/**
 * Test: --submit Flag for Graphite Stack Submissions
 *
 * Verifies the --submit flag behavior:
 *   --submit → implies → --worktree
 *   --submit is mutually exclusive with --pr and --ship
 *
 * And Docker incompatibility:
 *   --submit --docker → Error (Graphite worktree only)
 */

const assert = require('assert');

// Mock the CLI options processing logic
// This mirrors the logic in cli/index.js for --submit handling
function processOptions(options) {
  const result = { ...options };

  // --ship implies --pr
  if (result.ship) {
    result.pr = true;
  }

  // --pr implies --worktree (unless --docker explicitly set)
  if (result.pr && !result.docker) {
    result.worktree = true;
  }

  // Normalize for backward compatibility:
  // worktree and docker are mutually exclusive
  if (result.docker) {
    result.worktree = false;
  }

  // --submit = Graphite stack workflow (worktree isolation, no auto-merge)
  if (result.submit) {
    // Mutual exclusivity check with --pr and --ship
    if (result.pr || result.ship) {
      result.error = '--submit cannot be combined with --pr or --ship';
      return result;
    }
    if (result.docker) {
      result.error = '--submit does not support --docker';
      return result;
    }
    // Use worktree by default
    result.worktree = true;
  }

  return result;
}

describe('--submit Flag', function () {
  describe('basic behavior', function () {
    it('--submit should imply --worktree', function () {
      const result = processOptions({ submit: true });

      assert.strictEqual(result.submit, true);
      assert.strictEqual(result.worktree, true);
      assert.strictEqual(result.docker, undefined);
      assert.strictEqual(result.error, undefined);
    });

    it('--submit should NOT imply --pr', function () {
      const result = processOptions({ submit: true });

      assert.strictEqual(result.submit, true);
      assert.strictEqual(result.pr, undefined);
      assert.strictEqual(result.error, undefined);
    });

    it('--submit should NOT imply --ship', function () {
      const result = processOptions({ submit: true });

      assert.strictEqual(result.submit, true);
      assert.strictEqual(result.ship, undefined);
      assert.strictEqual(result.error, undefined);
    });
  });

  describe('mutual exclusivity', function () {
    it('--submit --pr should error', function () {
      const result = processOptions({ submit: true, pr: true });

      assert.strictEqual(result.error, '--submit cannot be combined with --pr or --ship');
    });

    it('--submit --ship should error', function () {
      const result = processOptions({ submit: true, ship: true });

      assert.strictEqual(result.error, '--submit cannot be combined with --pr or --ship');
    });

    it('--submit --pr --ship should error', function () {
      const result = processOptions({ submit: true, pr: true, ship: true });

      assert.strictEqual(result.error, '--submit cannot be combined with --pr or --ship');
    });
  });

  describe('Docker incompatibility', function () {
    it('--submit --docker should error', function () {
      const result = processOptions({ submit: true, docker: true });

      assert.strictEqual(result.error, '--submit does not support --docker');
    });
  });

  describe('Graphite workflow scenarios', function () {
    it('basic Graphite submission (lightweight worktree)', function () {
      const result = processOptions({ submit: true });

      // User gets: worktree isolation, Graphite stack submission, human review
      assert.strictEqual(result.worktree, true, 'Should use worktree');
      assert.strictEqual(result.docker, undefined, 'Should NOT use Docker');
      assert.strictEqual(result.submit, true, 'Submit flag set');
      assert.strictEqual(result.pr, undefined, 'PR flag NOT set');
      assert.strictEqual(result.ship, undefined, 'Ship flag NOT set');
    });

    it('Graphite submission with Docker isolation should error', function () {
      const result = processOptions({ submit: true, docker: true });

      assert.strictEqual(result.error, '--submit does not support --docker');
    });
  });

  describe('no interference with other flags', function () {
    it('--pr alone should still work', function () {
      const result = processOptions({ pr: true });

      assert.strictEqual(result.pr, true);
      assert.strictEqual(result.worktree, true);
      assert.strictEqual(result.submit, undefined);
      assert.strictEqual(result.error, undefined);
    });

    it('--ship alone should still work', function () {
      const result = processOptions({ ship: true });

      assert.strictEqual(result.ship, true);
      assert.strictEqual(result.pr, true);
      assert.strictEqual(result.worktree, true);
      assert.strictEqual(result.submit, undefined);
      assert.strictEqual(result.error, undefined);
    });

    it('--worktree alone should still work', function () {
      const result = processOptions({ worktree: true });

      assert.strictEqual(result.worktree, true);
      assert.strictEqual(result.submit, undefined);
      assert.strictEqual(result.pr, undefined);
      assert.strictEqual(result.error, undefined);
    });
  });
});

describe('git-submitter agent injection', function () {
  const fs = require('fs');
  const path = require('path');

  it('git-submitter-agent.json should exist', function () {
    const agentPath = path.join(__dirname, '../../src/agents/git-submitter-agent.json');
    assert.strictEqual(fs.existsSync(agentPath), true, 'git-submitter-agent.json should exist');
  });

  it('git-submitter-agent.json should have valid structure', function () {
    const agentPath = path.join(__dirname, '../../src/agents/git-submitter-agent.json');
    const config = JSON.parse(fs.readFileSync(agentPath, 'utf8'));

    assert.strictEqual(config.id, 'git-submitter', 'Agent ID should be git-submitter');
    assert.strictEqual(config.role, 'completion-detector', 'Role should be completion-detector');
    assert.strictEqual(config.model, 'sonnet', 'Model should be sonnet');
    assert.ok(config.triggers, 'Should have triggers');
    assert.ok(config.triggers[0].topic === 'VALIDATION_RESULT', 'Should trigger on VALIDATION_RESULT');
    assert.ok(config.prompt.includes('Graphite'), 'Prompt should mention Graphite');
    assert.ok(config.prompt.includes('gt create'), 'Prompt should mention gt create');
    assert.ok(config.prompt.includes('gt submit'), 'Prompt should mention gt submit');
  });

  it('git-submitter prompt should have issue placeholders', function () {
    const agentPath = path.join(__dirname, '../../src/agents/git-submitter-agent.json');
    const config = JSON.parse(fs.readFileSync(agentPath, 'utf8'));

    assert.ok(
      config.prompt.includes('{{issue_number}}'),
      'Prompt should have {{issue_number}} placeholder'
    );
    assert.ok(
      config.prompt.includes('{{issue_title}}'),
      'Prompt should have {{issue_title}} placeholder'
    );
  });

  it('git-submitter should NOT mention auto-merge', function () {
    const agentPath = path.join(__dirname, '../../src/agents/git-submitter-agent.json');
    const config = JSON.parse(fs.readFileSync(agentPath, 'utf8'));

    // The agent should explicitly NOT merge
    assert.ok(
      config.prompt.includes('Do NOT merge'),
      'Prompt should explicitly say NOT to merge'
    );
    assert.ok(
      !config.prompt.includes('gh pr merge'),
      'Prompt should NOT mention gh pr merge'
    );
  });
});

describe('Preflight Graphite check', function () {
  it('checkGraphite should be exported from preflight', function () {
    const preflight = require('../../src/preflight');
    assert.ok(typeof preflight.checkGraphite === 'function', 'checkGraphite should be a function');
  });
});
