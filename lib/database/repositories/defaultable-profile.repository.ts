/**
 * Defaultable Profile Repository
 *
 * The shared body of the image-profile and embedding-profile repositories:
 * named, user-owned, taggable profiles of which one per user is the default.
 * A subclass supplies its collection, schema and the noun its log lines and
 * error messages use.
 */

import { z } from 'zod';
import { logger } from '@/lib/logger';
import { TaggableBaseRepository, CreateOptions } from './base.repository';
import { TaggableEntity, TypedQueryFilter } from '../interfaces';

/** What a profile must carry for the shared operations. */
export interface DefaultableProfile extends TaggableEntity {
  name: string;
  provider: string;
  isDefault: boolean;
}

export interface DefaultableProfileOptions {
  /** The profile kind in lower case, as log lines and errors name it ("image profile"). */
  noun: string;
  /**
   * What `findByName` / `findDefault` do when the read itself fails:
   * rethrow (`'throw'`) or answer as though nothing was found (`'null'`).
   */
  onFinderFailure: 'throw' | 'null';
}

export abstract class DefaultableProfileRepository<
  T extends DefaultableProfile,
> extends TaggableBaseRepository<T> {
  private readonly noun: string;
  private readonly capitalNoun: string;
  private readonly onFinderFailure: 'throw' | 'null';

  constructor(collectionName: string, schema: z.ZodType, options: DefaultableProfileOptions) {
    super(collectionName, schema);
    this.noun = options.noun;
    this.capitalNoun = options.noun.charAt(0).toUpperCase() + options.noun.slice(1);
    this.onFinderFailure = options.onFinderFailure;
  }

  /** One profile matching `filter`, under this repository's finder-failure rule. */
  private findOneProfile(
    filter: Record<string, unknown>,
    errorMessage: string,
    context: Record<string, unknown>
  ): Promise<T | null> {
    const read = async () => (await this.findOneByFilter(filter as TypedQueryFilter<T>)) ?? null;
    return this.onFinderFailure === 'null'
      ? this.safeQuery(read, errorMessage, context, null)
      : this.safeQuery(read, errorMessage, context);
  }

  /** Find a user's profile by name. */
  async findByName(userId: string, name: string): Promise<T | null> {
    return this.findOneProfile({ userId, name }, `Error finding ${this.noun} by name`, { userId, name });
  }

  /** Find a user's default profile. */
  async findDefault(userId: string): Promise<T | null> {
    return this.findOneProfile({ userId, isDefault: true }, `Error finding default ${this.noun}`, { userId });
  }

  /**
   * Create a profile.
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   */
  async create(
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<T> {
    const context = { userId: data.userId, name: data.name, provider: data.provider };
    return this.safeQuery(
      async () => {
        const profile = await this._create(data, options);
        logger.info(`${this.capitalNoun} created successfully`, { profileId: profile.id, ...context });
        return profile;
      },
      `Error creating ${this.noun}`,
      context
    );
  }

  /** Update a profile. `_update` keeps the stored id and createdAt whatever the patch carries. */
  async update(id: string, data: Partial<T>): Promise<T | null> {
    return this.safeQuery(
      async () => {
        const profile = await this._update(id, data);
        if (profile) {
          logger.info(`${this.capitalNoun} updated successfully`, { profileId: id });
        }
        return profile;
      },
      `Error updating ${this.noun}`,
      { profileId: id }
    );
  }

  /** Delete a profile. */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);
        if (result) {
          logger.info(`${this.capitalNoun} deleted successfully`, { profileId: id });
        }
        return result;
      },
      `Error deleting ${this.noun}`,
      { profileId: id }
    );
  }

  /** Clear `isDefault` on every profile a user has, so a new default stands alone. */
  async unsetAllDefaults(userId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.updateMany(
          { userId, isDefault: true } as TypedQueryFilter<T>,
          { isDefault: false } as Partial<T>
        );
        logger.info(`All default ${this.noun}s unset for user`, { userId, modifiedCount: count });
        return count;
      },
      `Error unsetting all default ${this.noun}s`,
      { userId }
    );
  }
}
