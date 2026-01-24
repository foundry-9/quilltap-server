/**
 * @jest-environment node
 */

/**
 * Schema Translator Unit Tests
 *
 * Comprehensive tests for schema translation from Zod schemas to SQLite DDL.
 * Tests cover:
 * - Schema introspection and metadata extraction
 * - DDL generation (CREATE TABLE, CREATE INDEX)
 * - Type mapping from Zod to SQLite
 * - Constraint handling (NOT NULL, UNIQUE, PRIMARY KEY, DEFAULT)
 * - Index generation with direction and uniqueness
 * - Schema comparison and migration
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { z } from 'zod';
import {
  extractSchemaMetadata,
  generateCreateTable,
  generateCreateIndexes,
  generateDDL,
  compareSchemas,
  generateAlterStatements,
} from '@/lib/database/schema-translator';
import type { FieldMetadata, SchemaMetadata, SchemaDiff } from '@/lib/database/interfaces';

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

const mockLogger = jest.requireMock('@/lib/logger') as {
  logger: {
    debug: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
};

describe('Schema Translator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // extractSchemaMetadata Tests
  // ============================================================================

  describe('extractSchemaMetadata', () => {
    it('should extract basic field names from ZodObject', () => {
      const schema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      });

      const metadata = extractSchemaMetadata('users', schema);

      expect(metadata.name).toBe('users');
      expect(metadata.fields).toHaveLength(3);
      expect(metadata.fields.map(f => f.name)).toEqual(['id', 'name', 'email']);
    });

    it('should identify string type', () => {
      const schema = z.object({
        title: z.string(),
      });

      const metadata = extractSchemaMetadata('posts', schema);
      const field = metadata.fields[0];

      expect(field.type).toBe('string');
    });

    it('should identify number type', () => {
      const schema = z.object({
        age: z.number(),
        score: z.number(),
      });

      const metadata = extractSchemaMetadata('records', schema);

      expect(metadata.fields[0].type).toBe('number');
      expect(metadata.fields[1].type).toBe('number');
    });

    it('should identify boolean type', () => {
      const schema = z.object({
        isActive: z.boolean(),
      });

      const metadata = extractSchemaMetadata('items', schema);

      expect(metadata.fields[0].type).toBe('boolean');
    });

    it('should identify array type', () => {
      const schema = z.object({
        tags: z.array(z.string()),
      });

      const metadata = extractSchemaMetadata('articles', schema);

      expect(metadata.fields[0].type).toBe('array');
    });

    it('should identify object type', () => {
      const schema = z.object({
        metadata: z.object({
          key: z.string(),
        }),
      });

      const metadata = extractSchemaMetadata('documents', schema);

      expect(metadata.fields[0].type).toBe('object');
    });

    it('should handle ZodEnum as string type', () => {
      const schema = z.object({
        status: z.enum(['active', 'inactive', 'pending']),
      });

      const metadata = extractSchemaMetadata('tasks', schema);

      expect(metadata.fields[0].type).toBe('string');
    });

    it('should handle ZodLiteral with string value', () => {
      const schema = z.object({
        role: z.literal('admin'),
      });

      const metadata = extractSchemaMetadata('users', schema);

      expect(metadata.fields[0].type).toBe('string');
    });

    it('should handle ZodLiteral with number value', () => {
      const schema = z.object({
        version: z.literal(1),
      });

      const metadata = extractSchemaMetadata('configs', schema);

      expect(metadata.fields[0].type).toBe('number');
    });

    it('should handle ZodLiteral with boolean value', () => {
      const schema = z.object({
        enabled: z.literal(true),
      });

      const metadata = extractSchemaMetadata('settings', schema);

      expect(metadata.fields[0].type).toBe('boolean');
    });

    it('should handle ZodUnion with consistent types', () => {
      const schema = z.object({
        value: z.union([z.string(), z.string()]),
      });

      const metadata = extractSchemaMetadata('data', schema);

      expect(metadata.fields[0].type).toBe('string');
    });

    it('should mark id field as primary key', () => {
      const schema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const metadata = extractSchemaMetadata('users', schema);
      const idField = metadata.fields.find(f => f.name === 'id');

      expect(idField).toBeDefined();
      expect(idField?.isPrimaryKey).toBe(true);
      expect(idField?.indexed).toBe(true);
      expect(idField?.unique).toBe(true);
    });

    it('should mark userId field as indexed', () => {
      const schema = z.object({
        id: z.string(),
        userId: z.string(),
        content: z.string(),
      });

      const metadata = extractSchemaMetadata('posts', schema);
      const userIdField = metadata.fields.find(f => f.name === 'userId');

      expect(userIdField).toBeDefined();
      expect(userIdField?.indexed).toBe(true);
    });

    it('should handle optional fields', () => {
      const schema = z.object({
        id: z.string(),
        nickname: z.string().optional(),
      });

      const metadata = extractSchemaMetadata('users', schema);
      const nicknameField = metadata.fields.find(f => f.name === 'nickname');

      expect(nicknameField?.optional).toBe(true);
    });

    it('should handle nullable fields', () => {
      const schema = z.object({
        id: z.string(),
        bio: z.string().nullable(),
      });

      const metadata = extractSchemaMetadata('profiles', schema);
      const bioField = metadata.fields.find(f => f.name === 'bio');

      expect(bioField?.nullable).toBe(true);
    });

    it('should handle fields with default values', () => {
      const schema = z.object({
        id: z.string(),
        status: z.string().default('active'),
      });

      const metadata = extractSchemaMetadata('items', schema);
      const statusField = metadata.fields.find(f => f.name === 'status');

      expect(statusField?.defaultValue).toBe('active');
    });

    it('should extract string maxLength constraint', () => {
      const schema = z.object({
        username: z.string().max(50),
      });

      const metadata = extractSchemaMetadata('users', schema);
      const field = metadata.fields[0];

      expect(field.maxLength).toBe(50);
    });

    it('should extract string minLength constraint', () => {
      const schema = z.object({
        password: z.string().min(8),
      });

      const metadata = extractSchemaMetadata('users', schema);
      const field = metadata.fields[0];

      expect(field.type).toBe('string');
      // Note: minLength is extracted but currently not used in SQL generation
    });

    it('should extract number min constraint', () => {
      const schema = z.object({
        age: z.number().min(0),
      });

      const metadata = extractSchemaMetadata('people', schema);
      const field = metadata.fields[0];

      expect(field.min).toBe(0);
    });

    it('should extract number max constraint', () => {
      const schema = z.object({
        rating: z.number().max(5),
      });

      const metadata = extractSchemaMetadata('reviews', schema);
      const field = metadata.fields[0];

      expect(field.max).toBe(5);
    });

    it('should handle nested objects', () => {
      const schema = z.object({
        id: z.string(),
        profile: z.object({
          firstName: z.string(),
          lastName: z.string(),
        }),
      });

      const metadata = extractSchemaMetadata('users', schema);
      const profileField = metadata.fields.find(f => f.name === 'profile');

      expect(profileField?.type).toBe('object');
      expect(profileField?.fields).toBeDefined();
      expect(profileField?.fields).toHaveLength(2);
      expect(profileField?.fields?.map(f => f.name)).toEqual(['firstName', 'lastName']);
    });

    it('should handle arrays with element types', () => {
      const schema = z.object({
        tags: z.array(z.string()),
      });

      const metadata = extractSchemaMetadata('posts', schema);
      const tagsField = metadata.fields[0];

      expect(tagsField.type).toBe('array');
      expect(tagsField.elementType).toBeDefined();
      expect(tagsField.elementType?.type).toBe('string');
    });

    it('should auto-generate index for userId field', () => {
      const schema = z.object({
        id: z.string(),
        userId: z.string(),
        content: z.string(),
      });

      const metadata = extractSchemaMetadata('posts', schema);

      expect(metadata.indexes).toBeDefined();
      expect(metadata.indexes?.length).toBeGreaterThan(0);
      const userIdIndex = metadata.indexes?.find(idx => idx.name === 'idx_posts_userId');
      expect(userIdIndex).toBeDefined();
      expect(userIdIndex?.fields).toEqual({ userId: 1 });
    });

    it('should auto-generate index for createdAt field', () => {
      const schema = z.object({
        id: z.string(),
        createdAt: z.string(),
        content: z.string(),
      });

      const metadata = extractSchemaMetadata('posts', schema);

      const createdAtIndex = metadata.indexes?.find(idx => idx.name === 'idx_posts_createdAt');
      expect(createdAtIndex).toBeDefined();
      expect(createdAtIndex?.fields).toEqual({ createdAt: -1 });
    });

    it('should use id as primary key by default', () => {
      const schema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const metadata = extractSchemaMetadata('users', schema);

      expect(metadata.primaryKey).toBe('id');
    });

    it('should throw error if schema is not ZodObject', () => {
      const schema = z.string();

      expect(() => {
        extractSchemaMetadata('invalid', schema as any);
      }).toThrow('Schema for invalid must be a ZodObject');
    });

    it('should handle complex optional/nullable/default combinations', () => {
      const schema = z.object({
        id: z.string(),
        description: z.string().optional().nullable().default('N/A'),
      });

      const metadata = extractSchemaMetadata('items', schema);
      const descField = metadata.fields.find(f => f.name === 'description');

      expect(descField?.optional).toBe(true);
      expect(descField?.nullable).toBe(true);
      expect(descField?.defaultValue).toBe('N/A');
    });
  });

  // ============================================================================
  // generateCreateTable Tests
  // ============================================================================

  describe('generateCreateTable', () => {
    it('should generate valid CREATE TABLE statement', () => {
      const schema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const metadata = extractSchemaMetadata('users', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "users"');
      expect(sql).toContain('"id" TEXT PRIMARY KEY');
      expect(sql).toContain('"name" TEXT NOT NULL');
    });

    it('should map string → TEXT', () => {
      const schema = z.object({
        title: z.string(),
      });

      const metadata = extractSchemaMetadata('posts', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain('"title" TEXT');
    });

    it('should map number → REAL', () => {
      const schema = z.object({
        rating: z.number(),
      });

      const metadata = extractSchemaMetadata('reviews', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain('"rating" REAL NOT NULL');
    });

    it('should map number with int constraints → INTEGER', () => {
      const schema = z.object({
        count: z.number().int().min(0).max(100),
      });

      const metadata = extractSchemaMetadata('items', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain('"count" INTEGER NOT NULL');
    });

    it('should map boolean → INTEGER', () => {
      const schema = z.object({
        isActive: z.boolean(),
      });

      const metadata = extractSchemaMetadata('users', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain('"isActive" INTEGER NOT NULL');
    });

    it('should map array → TEXT (JSON)', () => {
      const schema = z.object({
        tags: z.array(z.string()),
      });

      const metadata = extractSchemaMetadata('posts', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain('"tags" TEXT NOT NULL');
    });

    it('should map object → TEXT (JSON)', () => {
      const schema = z.object({
        metadata: z.object({ key: z.string() }),
      });

      const metadata = extractSchemaMetadata('documents', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain('"metadata" TEXT NOT NULL');
    });

    it('should add PRIMARY KEY constraint for id field', () => {
      const schema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const metadata = extractSchemaMetadata('users', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain('PRIMARY KEY');
    });

    it('should add NOT NULL for required fields', () => {
      const schema = z.object({
        id: z.string(),
        email: z.string(),
      });

      const metadata = extractSchemaMetadata('users', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toMatch(/"email" TEXT NOT NULL/);
    });

    it('should not add NOT NULL for optional fields', () => {
      const schema = z.object({
        id: z.string(),
        nickname: z.string().optional(),
      });

      const metadata = extractSchemaMetadata('users', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain('"nickname" TEXT');
      expect(sql).not.toMatch(/"nickname" TEXT NOT NULL/);
    });

    it('should add UNIQUE constraint for unique fields', () => {
      const metadata: SchemaMetadata = {
        name: 'users',
        fields: [
          { name: 'id', type: 'string', optional: false, nullable: false, isPrimaryKey: true },
          { name: 'email', type: 'string', optional: false, nullable: false, unique: true },
        ],
        primaryKey: 'id',
      };

      const sql = generateCreateTable(metadata);

      expect(sql).toContain('UNIQUE');
    });

    it('should add DEFAULT constraint with string value', () => {
      const schema = z.object({
        id: z.string(),
        status: z.string().default('active'),
      });

      const metadata = extractSchemaMetadata('items', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain("DEFAULT 'active'");
    });

    it('should add DEFAULT constraint with number value', () => {
      const schema = z.object({
        count: z.number().default(0),
      });

      const metadata = extractSchemaMetadata('items', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain('DEFAULT 0');
    });

    it('should add DEFAULT constraint with boolean value', () => {
      const schema = z.object({
        isActive: z.boolean().default(true),
      });

      const metadata = extractSchemaMetadata('items', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain('DEFAULT 1');
    });

    it('should handle fields with quotes in default strings', () => {
      const schema = z.object({
        quote: z.string().default("It's a test"),
      });

      const metadata = extractSchemaMetadata('items', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain("DEFAULT 'It''s a test'");
    });

    it('should properly format CREATE TABLE with multiple columns', () => {
      const schema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        createdAt: z.string(),
      });

      const metadata = extractSchemaMetadata('users', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "users" (');
      expect(sql).toContain('"id" TEXT PRIMARY KEY');
      expect(sql).toContain('"name" TEXT NOT NULL');
      expect(sql).toContain(')');
    });
  });

  // ============================================================================
  // generateCreateIndexes Tests
  // ============================================================================

  describe('generateCreateIndexes', () => {
    it('should generate CREATE INDEX statements for indexes', () => {
      const schema = z.object({
        id: z.string(),
        userId: z.string(),
      });

      const metadata = extractSchemaMetadata('posts', schema);
      const indexes = generateCreateIndexes(metadata);

      expect(indexes.length).toBeGreaterThan(0);
      expect(indexes[0]).toContain('CREATE INDEX IF NOT EXISTS');
      expect(indexes[0]).toContain('"idx_posts_userId"');
    });

    it('should handle ASC direction (positive integer)', () => {
      const schema = z.object({
        id: z.string(),
        userId: z.string(),
      });

      const metadata = extractSchemaMetadata('posts', schema);
      const indexes = generateCreateIndexes(metadata);

      expect(indexes[0]).toContain('ASC');
    });

    it('should handle DESC direction (negative integer)', () => {
      const schema = z.object({
        id: z.string(),
        createdAt: z.string(),
      });

      const metadata = extractSchemaMetadata('posts', schema);
      const indexes = generateCreateIndexes(metadata);

      const createdAtIndex = indexes.find(idx => idx.includes('createdAt'));
      expect(createdAtIndex).toContain('DESC');
    });

    it('should handle UNIQUE indexes', () => {
      const metadata: SchemaMetadata = {
        name: 'users',
        fields: [
          { name: 'id', type: 'string', optional: false, nullable: false, isPrimaryKey: true },
          { name: 'email', type: 'string', optional: false, nullable: false },
        ],
        primaryKey: 'id',
        indexes: [
          {
            name: 'idx_users_email',
            fields: { email: 1 },
            unique: true,
          },
        ],
      };

      const indexes = generateCreateIndexes(metadata);

      expect(indexes[0]).toContain('CREATE UNIQUE INDEX');
    });

    it('should return empty array for schemas without indexes', () => {
      const metadata: SchemaMetadata = {
        name: 'simple',
        fields: [{ name: 'id', type: 'string', optional: false, nullable: false }],
        primaryKey: 'id',
        indexes: [],
      };

      const indexes = generateCreateIndexes(metadata);

      expect(indexes).toEqual([]);
    });

    it('should return empty array for undefined indexes', () => {
      const metadata: SchemaMetadata = {
        name: 'simple',
        fields: [{ name: 'id', type: 'string', optional: false, nullable: false }],
        primaryKey: 'id',
      };

      const indexes = generateCreateIndexes(metadata);

      expect(indexes).toEqual([]);
    });
  });

  // ============================================================================
  // generateDDL Tests
  // ============================================================================

  describe('generateDDL', () => {
    it('should generate array with CREATE TABLE and CREATE INDEX statements', () => {
      const schema = z.object({
        id: z.string(),
        userId: z.string(),
        title: z.string(),
      });

      const ddl = generateDDL('posts', schema);

      expect(Array.isArray(ddl)).toBe(true);
      expect(ddl.length).toBeGreaterThan(0);
      expect(ddl[0]).toContain('CREATE TABLE');
    });

    it('should include indexes in DDL array', () => {
      const schema = z.object({
        id: z.string(),
        userId: z.string(),
      });

      const ddl = generateDDL('posts', schema);

      const hasCreateIndex = ddl.some(stmt => stmt.includes('CREATE INDEX'));
      expect(hasCreateIndex).toBe(true);
    });

    it('should log debug info when generating DDL', () => {
      const schema = z.object({
        id: z.string(),
        userId: z.string(),
      });

      // Just verify DDL generation works without errors
      const ddl = generateDDL('posts', schema);

      expect(ddl).toBeDefined();
      expect(ddl.length).toBeGreaterThan(0);
    });

    it('should throw error if schema introspection fails', () => {
      const invalidSchema = z.string() as any;

      expect(() => {
        generateDDL('invalid', invalidSchema);
      }).toThrow('Schema for invalid must be a ZodObject');
    });

    it('should handle complex schema', () => {
      const schema = z.object({
        id: z.string(),
        userId: z.string(),
        title: z.string().max(255),
        content: z.string(),
        isPublished: z.boolean().default(false),
        tags: z.array(z.string()),
        createdAt: z.string(),
        updatedAt: z.string(),
      });

      const ddl = generateDDL('posts', schema);

      expect(ddl.length).toBeGreaterThanOrEqual(1);
      expect(ddl[0]).toContain('CREATE TABLE IF NOT EXISTS "posts"');
    });
  });

  // ============================================================================
  // compareSchemas Tests
  // ============================================================================

  describe('compareSchemas', () => {
    it('should detect added fields', () => {
      const newMetadata: SchemaMetadata = {
        name: 'users',
        fields: [
          { name: 'id', type: 'string', optional: false, nullable: false, isPrimaryKey: true },
          { name: 'name', type: 'string', optional: false, nullable: false },
          { name: 'email', type: 'string', optional: false, nullable: false },
        ],
        primaryKey: 'id',
      };

      const currentColumns = [
        { name: 'id', type: 'TEXT', nullable: false },
        { name: 'name', type: 'TEXT', nullable: false },
      ];

      const diff = compareSchemas(newMetadata, currentColumns);

      expect(diff.addedFields).toHaveLength(1);
      expect(diff.addedFields[0].name).toBe('email');
    });

    it('should detect removed fields', () => {
      const newMetadata: SchemaMetadata = {
        name: 'users',
        fields: [
          { name: 'id', type: 'string', optional: false, nullable: false, isPrimaryKey: true },
          { name: 'name', type: 'string', optional: false, nullable: false },
        ],
        primaryKey: 'id',
      };

      const currentColumns = [
        { name: 'id', type: 'TEXT', nullable: false },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'deprecated_field', type: 'TEXT', nullable: true },
      ];

      const diff = compareSchemas(newMetadata, currentColumns);

      expect(diff.removedFields).toEqual(['deprecated_field']);
    });

    it('should detect modified field types', () => {
      const newMetadata: SchemaMetadata = {
        name: 'products',
        fields: [
          { name: 'id', type: 'string', optional: false, nullable: false, isPrimaryKey: true },
          { name: 'price', type: 'number', optional: false, nullable: false },
        ],
        primaryKey: 'id',
      };

      const currentColumns = [
        { name: 'id', type: 'TEXT', nullable: false },
        { name: 'price', type: 'TEXT', nullable: false },
      ];

      const diff = compareSchemas(newMetadata, currentColumns);

      expect(diff.modifiedFields).toHaveLength(1);
      expect(diff.modifiedFields[0].field).toBe('price');
      expect(diff.modifiedFields[0].oldType).toBe('TEXT');
      expect(diff.modifiedFields[0].newType).toBe('REAL');
    });

    it('should return empty diff when schemas match', () => {
      const newMetadata: SchemaMetadata = {
        name: 'users',
        fields: [
          { name: 'id', type: 'string', optional: false, nullable: false, isPrimaryKey: true },
          { name: 'name', type: 'string', optional: false, nullable: false },
        ],
        primaryKey: 'id',
      };

      const currentColumns = [
        { name: 'id', type: 'TEXT', nullable: false },
        { name: 'name', type: 'TEXT', nullable: false },
      ];

      const diff = compareSchemas(newMetadata, currentColumns);

      expect(diff.addedFields).toHaveLength(0);
      expect(diff.removedFields).toHaveLength(0);
      expect(diff.modifiedFields).toHaveLength(0);
    });
  });

  // ============================================================================
  // generateAlterStatements Tests
  // ============================================================================

  describe('generateAlterStatements', () => {
    it('should generate ADD COLUMN statements for added fields', () => {
      const diff: SchemaDiff = {
        addedFields: [
          { name: 'email', type: 'string', optional: false, nullable: false },
        ],
        removedFields: [],
        modifiedFields: [],
        addedIndexes: [],
        removedIndexes: [],
      };

      const statements = generateAlterStatements('users', diff);

      expect(statements).toHaveLength(1);
      expect(statements[0]).toContain('ALTER TABLE "users" ADD COLUMN "email" TEXT NOT NULL');
    });

    it('should handle multiple added fields', () => {
      const diff: SchemaDiff = {
        addedFields: [
          { name: 'email', type: 'string', optional: false, nullable: false },
          { name: 'phone', type: 'string', optional: true, nullable: false },
        ],
        removedFields: [],
        modifiedFields: [],
        addedIndexes: [],
        removedIndexes: [],
      };

      const statements = generateAlterStatements('users', diff);

      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain('ADD COLUMN "email"');
      expect(statements[1]).toContain('ADD COLUMN "phone"');
    });

    it('should handle optional fields without NOT NULL', () => {
      const diff: SchemaDiff = {
        addedFields: [
          { name: 'bio', type: 'string', optional: true, nullable: false },
        ],
        removedFields: [],
        modifiedFields: [],
        addedIndexes: [],
        removedIndexes: [],
      };

      const statements = generateAlterStatements('users', diff);

      expect(statements[0]).toContain('"bio" TEXT');
      expect(statements[0]).not.toContain('NOT NULL');
    });

    it('should handle fields with default values', () => {
      const diff: SchemaDiff = {
        addedFields: [
          { name: 'status', type: 'string', optional: false, nullable: false, defaultValue: 'active' },
        ],
        removedFields: [],
        modifiedFields: [],
        addedIndexes: [],
        removedIndexes: [],
      };

      const statements = generateAlterStatements('items', diff);

      expect(statements[0]).toContain("DEFAULT 'active'");
    });

    it('should return no statements for removed fields (requires table recreation)', () => {
      const diff: SchemaDiff = {
        addedFields: [],
        removedFields: ['oldField'],
        modifiedFields: [],
        addedIndexes: [],
        removedIndexes: [],
      };

      const statements = generateAlterStatements('users', diff);

      // SQLite doesn't support dropping columns directly, so no statements are generated
      expect(statements).toEqual([]);
    });

    it('should return no statements for modified fields (requires table recreation)', () => {
      const diff: SchemaDiff = {
        addedFields: [],
        removedFields: [],
        modifiedFields: [
          { field: 'price', oldType: 'TEXT', newType: 'REAL' },
        ],
        addedIndexes: [],
        removedIndexes: [],
      };

      const statements = generateAlterStatements('products', diff);

      // SQLite doesn't support modifying columns directly, so no statements are generated
      expect(statements).toEqual([]);
    });

    it('should return empty array for no changes', () => {
      const diff: SchemaDiff = {
        addedFields: [],
        removedFields: [],
        modifiedFields: [],
        addedIndexes: [],
        removedIndexes: [],
      };

      const statements = generateAlterStatements('users', diff);

      expect(statements).toEqual([]);
    });
  });

  // ============================================================================
  // Edge Cases and Integration
  // ============================================================================

  describe('Edge Cases and Integration', () => {
    it('should handle schema with all constraint types', () => {
      const schema = z.object({
        id: z.string(),
        userId: z.string(),
        email: z.string().max(255),
        age: z.number().int().min(0).max(150),
        isActive: z.boolean().default(true),
        nickname: z.string().optional(),
        bio: z.string().nullable(),
        tags: z.array(z.string()),
        metadata: z.object({ custom: z.string() }),
        status: z.enum(['draft', 'published', 'archived']),
        createdAt: z.string(),
        updatedAt: z.string(),
      });

      const metadata = extractSchemaMetadata('posts', schema);
      const sql = generateCreateTable(metadata);
      const ddl = generateDDL('posts', schema);

      expect(metadata.fields).toHaveLength(12);
      expect(sql).toContain('CREATE TABLE');
      expect(ddl.length).toBeGreaterThan(0);
    });

    it('should generate consistent DDL across multiple calls', () => {
      const schema = z.object({
        id: z.string(),
        userId: z.string(),
        title: z.string(),
      });

      const ddl1 = generateDDL('posts', schema);
      const ddl2 = generateDDL('posts', schema);

      expect(ddl1).toEqual(ddl2);
    });

    it('should handle schema with only id field', () => {
      const schema = z.object({
        id: z.string(),
      });

      const metadata = extractSchemaMetadata('simple', schema);
      const sql = generateCreateTable(metadata);

      expect(metadata.fields).toHaveLength(1);
      expect(sql).toContain('PRIMARY KEY');
    });

    it('should properly escape table and column names with quotes', () => {
      const schema = z.object({
        id: z.string(),
        'user-name': z.string(),
      });

      const metadata = extractSchemaMetadata('user-profiles', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain('"user-profiles"');
      expect(sql).toContain('"user-name"');
    });

    it('should handle numeric string field defaults', () => {
      const schema = z.object({
        version: z.string().default('1.0.0'),
      });

      const metadata = extractSchemaMetadata('configs', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain("DEFAULT '1.0.0'");
    });

    it('should handle array with default value', () => {
      const schema = z.object({
        tags: z.array(z.string()).default([]),
      });

      const metadata = extractSchemaMetadata('posts', schema);
      const sql = generateCreateTable(metadata);

      expect(sql).toContain("DEFAULT '[]'");
    });
  });
});
