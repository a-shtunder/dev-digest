import { describe, it, expect } from 'vitest';
import {
  parseEvidencePath,
  buildGithubBlobUrl,
  toConventionDto,
} from '../src/modules/conventions/helpers.js';
import type { ConventionRow } from '../src/modules/conventions/repository.js';

describe('conventions helpers', () => {
  describe('parseEvidencePath', () => {
    it('splits a trailing :line', () => {
      expect(parseEvidencePath('src/api/users.ts:23')).toEqual({
        path: 'src/api/users.ts',
        line: 23,
      });
    });

    it('splits a trailing :start-end (keeps the start line)', () => {
      expect(parseEvidencePath('src/api/users.ts:23-31')).toEqual({
        path: 'src/api/users.ts',
        line: 23,
      });
    });

    it('returns the path unchanged when there is no line', () => {
      expect(parseEvidencePath('README.md')).toEqual({ path: 'README.md' });
    });
  });

  describe('buildGithubBlobUrl', () => {
    it('anchors the cited line', () => {
      expect(buildGithubBlobUrl('acme', 'payments-api', 'main', 'src/lib/redis.ts', 9)).toBe(
        'https://github.com/acme/payments-api/blob/main/src/lib/redis.ts#L9',
      );
    });

    it('omits the anchor when there is no line', () => {
      expect(buildGithubBlobUrl('acme', 'payments-api', 'dev', 'tsconfig.json')).toBe(
        'https://github.com/acme/payments-api/blob/dev/tsconfig.json',
      );
    });
  });

  describe('toConventionDto', () => {
    const row: ConventionRow = {
      id: 'c1',
      workspaceId: 'ws1',
      repoId: 'r1',
      rule: 'Always use async/await',
      evidencePath: 'src/api/users.ts:23',
      evidenceSnippet: 'const u = await db.find(id);',
      confidence: 0.91,
      accepted: false,
    };

    it('maps a row to the DTO and carries the evidence url', () => {
      expect(toConventionDto(row, 'https://github.com/acme/x/blob/main/src/api/users.ts#L23')).toEqual({
        id: 'c1',
        rule: 'Always use async/await',
        evidence_path: 'src/api/users.ts:23',
        evidence_snippet: 'const u = await db.find(id);',
        confidence: 0.91,
        accepted: false,
        evidence_url: 'https://github.com/acme/x/blob/main/src/api/users.ts#L23',
      });
    });
  });
});
