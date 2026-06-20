/**
 * @jest-environment node
 *
 * Surface gate for the Brahma `run_sql` tool in the tool executor.
 *
 * The tool is OFFERED only when `sqlAccess` is true (Brahma builder), and is
 * EXECUTED only when `context.operatorSurface` is true. This covers the second
 * gate: even if a `run_sql` tool name leaked into a character surface's history,
 * the executor refuses to run it without the operator surface.
 *
 * The handler itself is mocked (its behavior is covered by run-sql-handler.test).
 */

// ── Mocks (bare factory; configured via jest.mocked) ──────────────────────────
jest.mock('@/lib/tools/handlers/run-sql-handler', () => ({
  executeRunSqlTool: jest.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { executeToolCallWithContext } from '@/lib/chat/tool-executor';
import { executeRunSqlTool } from '@/lib/tools/handlers/run-sql-handler';

describe('run_sql surface gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects when operatorSurface is falsy, without executing the handler', async () => {
    const result = await executeToolCallWithContext(
      { name: 'run_sql', arguments: { sql: 'SELECT 1' } },
      { chatId: 'chat-1', userId: 'user-1' }, // no operatorSurface
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/only available in the Brahma Console/i);
    expect(executeRunSqlTool).not.toHaveBeenCalled();
  });

  it('executes the handler when operatorSurface is true', async () => {
    jest.mocked(executeRunSqlTool).mockResolvedValue({
      success: true,
      database: 'main',
      columns: ['n'],
      rows: [{ n: 1 }],
      rowCount: 1,
      truncated: false,
    });

    const result = await executeToolCallWithContext(
      { name: 'run_sql', arguments: { sql: 'SELECT 1 AS n' } },
      { chatId: 'chat-1', userId: 'user-1', operatorSurface: true },
    );

    expect(executeRunSqlTool).toHaveBeenCalledWith({ sql: 'SELECT 1 AS n' }, { userId: 'user-1' });
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ database: 'main', rowCount: 1, truncated: false });
  });

  it('surfaces a handler failure as a tool error (operatorSurface true)', async () => {
    jest.mocked(executeRunSqlTool).mockResolvedValue({
      success: false,
      error: 'Only read-only queries are permitted.',
    });

    const result = await executeToolCallWithContext(
      { name: 'run_sql', arguments: { sql: 'DELETE FROM notes' } },
      { chatId: 'chat-1', userId: 'user-1', operatorSurface: true },
    );

    expect(result.success).toBe(false);
    expect(result.result).toBeNull();
    expect(result.error).toMatch(/read-only/i);
  });
});
