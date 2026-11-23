/**
 * Image Profiles Repository
 *
 * Backend-agnostic repository for ImageProfile entities.
 * Works with SQLite through the database abstraction layer.
 */

import { ImageProfile, ImageProfileSchema } from '@/lib/schemas/types';
import { DefaultableProfileRepository } from './defaultable-profile.repository';

/**
 * Image Profiles Repository
 * CRUD for image profiles with user-scoping, tag support and default-profile
 * management, all inherited from {@link DefaultableProfileRepository}.
 */
export class ImageProfilesRepository extends DefaultableProfileRepository<ImageProfile> {
  constructor() {
    super('image_profiles', ImageProfileSchema, { noun: 'image profile', onFinderFailure: 'throw' });
  }
}
