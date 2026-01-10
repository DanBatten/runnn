/**
 * Debug command - Explain recommendations
 */

import chalk from 'chalk';
import { isDbInitialized, closeDb, queryOne } from '../db/client.js';

export async function debugWhyCommand(decisionId: string): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  console.log(chalk.bold(`Debugging decision: ${decisionId}`));
  console.log('');

  // Try to find the decision
  const decision = queryOne(
    'SELECT * FROM coaching_decisions WHERE id = ?',
    [decisionId]
  );

  if (!decision) {
    console.log(chalk.red(`Decision not found: ${decisionId}`));
    closeDb();
    return;
  }

  console.log(chalk.yellow('Debug why not yet fully implemented'));
  console.log('');
  console.log('This command will show:');
  console.log('  - Full context that was loaded');
  console.log('  - Policies that applied');
  console.log('  - Patterns that influenced');
  console.log('  - Overrides in effect');
  console.log('  - Prediction made');
  console.log('  - Link to coach session');

  closeDb();
}
