/**
 * Migration Types
 *
 * Defines the interfaces for version upgrade migrations in Quilltap.
 * These types were originally in the qtap-plugin-upgrade plugin
 * but have been moved to the core app for startup-time execution.
 */

/**
 * Result of running a single migration
 */
export interface MigrationResult {
  /** Migration ID */
  id: string;
  /** Whether the migration succeeded */
  success: boolean;
  /** Number of items affected (e.g., profiles converted) */
  itemsAffected: number;
  /** Human-readable message */
  message: string;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Timestamp when migration ran */
  timestamp: string;
}

/**
 * Migration definition interface
 */
export interface Migration {
  /** Unique identifier for this migration */
  id: string;
  /** Human-readable description */
  description: string;
  /** Version this migration was introduced */
  introducedInVersion: string;
  /** Dependencies on other migrations (by ID) */
  dependsOn?: string[];
  /** Function to check if migration needs to run */
  shouldRun: () => Promise<boolean>;
  /** Function to run the migration */
  run: () => Promise<MigrationResult>;
  /** Optional rollback function */
  rollback?: () => Promise<MigrationResult>;
}

/**
 * Migration state stored in the migrations tracking collection
 */
export interface MigrationState {
  /** Migrations that have been completed */
  completedMigrations: MigrationRecord[];
  /** Last time migrations were checked */
  lastChecked: string;
  /** Current Quilltap version */
  quilltapVersion: string;
}

/**
 * Record of a completed migration
 */
export interface MigrationRecord {
  /** Migration ID */
  id: string;
  /** When the migration ran */
  completedAt: string;
  /** Version of Quilltap when migration ran */
  quilltapVersion: string;
  /** Items affected */
  itemsAffected: number;
  /** Result message */
  message: string;
}

/**
 * Result of running all migrations
 */
export interface MigrationRunResult {
  /** Whether all migrations succeeded */
  success: boolean;
  /** Number of migrations that ran */
  migrationsRun: number;
  /** Number of migrations skipped (already completed or conditions not met) */
  migrationsSkipped: number;
  /** Results for each migration that ran */
  results: MigrationResult[];
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Failed migration IDs */
  failed?: string[];
  /** Error message if overall process failed */
  error?: string;
}
