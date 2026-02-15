/**
 * Unit Tests for File Path Utilities
 * Tests lib/api/middleware/file-path.ts
 * v2.7-dev: File path resolution for API responses
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { FileEntry, Character } from '@/lib/schemas/types';

const {
  getFilePath,
  getAvatarPath,
  enrichWithDefaultImage,
  buildFileReference,
} = require('@/lib/api/middleware/file-path');

describe('File Path Utilities', () => {
  describe('getFilePath', () => {
    it('should return API route for file with storageKey', () => {
      const file: FileEntry = {
        id: 'file-1',
        originalFilename: 'image.png',
        mimeType: 'image/png',
        size: 1024,
        storageKey: 's3://bucket/key',
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const path = getFilePath(file);
      expect(path).toBe('/api/v1/files/file-1');
    });

    it('should return API route for file with s3Key', () => {
      const file: FileEntry = {
        id: 'file-2',
        originalFilename: 'document.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        s3Key: 'uploads/document.pdf',
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const path = getFilePath(file);
      expect(path).toBe('/api/v1/files/file-2');
    });

    it('should return API route for legacy file without storageKey', () => {
      const file: FileEntry = {
        id: 'file-3',
        originalFilename: 'avatar.jpg',
        mimeType: 'image/jpeg',
        size: 512,
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const path = getFilePath(file);
      expect(path).toBe('/api/v1/files/file-3');
    });

    it('should return API route for legacy file with complex name', () => {
      const file: FileEntry = {
        id: 'file-4',
        originalFilename: 'image.complex.name.png',
        mimeType: 'image/png',
        size: 1024,
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const path = getFilePath(file);
      expect(path).toBe('/api/v1/files/file-4');
    });

    it('should return API route for legacy file without extension', () => {
      const file: FileEntry = {
        id: 'file-5',
        originalFilename: 'noextension',
        mimeType: 'application/octet-stream',
        size: 256,
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const path = getFilePath(file);
      expect(path).toBe('/api/v1/files/file-5');
    });

    it('should prefer storageKey over s3Key when both present', () => {
      const file: FileEntry = {
        id: 'file-6',
        originalFilename: 'test.txt',
        mimeType: 'text/plain',
        size: 128,
        storageKey: 'new-storage',
        s3Key: 'old-s3-key',
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const path = getFilePath(file);
      expect(path).toBe('/api/v1/files/file-6');
    });
  });

  describe('getAvatarPath', () => {
    it('should return file path when file is provided', () => {
      const entity = { defaultImageId: 'img-1', avatarUrl: null };
      const file: FileEntry = {
        id: 'img-1',
        originalFilename: 'avatar.png',
        mimeType: 'image/png',
        size: 1024,
        storageKey: 's3://bucket/avatar',
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = getAvatarPath(entity, file);

      expect(result).toEqual({
        id: 'img-1',
        filepath: '/api/v1/files/img-1',
        url: null,
      });
    });

    it('should return avatarUrl when no file but avatarUrl exists', () => {
      const entity = {
        defaultImageId: null,
        avatarUrl: 'https://example.com/avatar.png',
      };

      const result = getAvatarPath(entity, null);

      expect(result).toEqual({
        id: '',
        filepath: 'https://example.com/avatar.png',
        url: 'https://example.com/avatar.png',
      });
    });

    it('should return null when no file and no avatarUrl', () => {
      const entity = { defaultImageId: null, avatarUrl: null };

      const result = getAvatarPath(entity, null);

      expect(result).toBeNull();
    });

    it('should prefer file over avatarUrl when both present', () => {
      const entity = {
        defaultImageId: 'img-1',
        avatarUrl: 'https://example.com/avatar.png',
      };
      const file: FileEntry = {
        id: 'img-1',
        originalFilename: 'avatar.jpg',
        mimeType: 'image/jpeg',
        size: 2048,
        storageKey: 's3://bucket/key',
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = getAvatarPath(entity, file);

      expect(result).toEqual({
        id: 'img-1',
        filepath: '/api/v1/files/img-1',
        url: null,
      });
    });

    it('should handle entity without optional fields', () => {
      const entity = {};
      const result = getAvatarPath(entity, null);

      expect(result).toBeNull();
    });
  });

  describe('enrichWithDefaultImage', () => {
    let mockGetFile: jest.Mock;

    beforeEach(() => {
      mockGetFile = jest.fn();
    });

    it('should enrich entity with default image when file exists', async () => {
      const entity = { defaultImageId: 'img-1', avatarUrl: null };
      const file: FileEntry = {
        id: 'img-1',
        originalFilename: 'default.png',
        mimeType: 'image/png',
        size: 1024,
        storageKey: 's3://bucket/default',
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockGetFile.mockResolvedValue(file);

      const result = await enrichWithDefaultImage(entity, mockGetFile);

      expect(mockGetFile).toHaveBeenCalledWith('img-1');
      expect(result).toEqual({
        id: 'img-1',
        filepath: '/api/v1/files/img-1',
        url: null,
      });
    });

    it('should return null when entity is null', async () => {
      const result = await enrichWithDefaultImage(null, mockGetFile);

      expect(result).toBeNull();
      expect(mockGetFile).not.toHaveBeenCalled();
    });

    it('should return null when entity has no defaultImageId', async () => {
      const entity = { defaultImageId: null, avatarUrl: null };

      const result = await enrichWithDefaultImage(entity, mockGetFile);

      expect(result).toBeNull();
      expect(mockGetFile).not.toHaveBeenCalled();
    });

    it('should fallback to avatarUrl when file not found', async () => {
      const entity = {
        defaultImageId: 'img-missing',
        avatarUrl: 'https://example.com/fallback.png',
      };

      mockGetFile.mockResolvedValue(null);

      const result = await enrichWithDefaultImage(entity, mockGetFile);

      expect(mockGetFile).toHaveBeenCalledWith('img-missing');
      expect(result).toEqual({
        id: '',
        filepath: 'https://example.com/fallback.png',
        url: 'https://example.com/fallback.png',
      });
    });

    it('should return null when file not found and no avatarUrl', async () => {
      const entity = { defaultImageId: 'img-missing', avatarUrl: null };

      mockGetFile.mockResolvedValue(null);

      const result = await enrichWithDefaultImage(entity, mockGetFile);

      expect(result).toBeNull();
    });

    it('should use avatarUrl when no defaultImageId', async () => {
      const entity = {
        defaultImageId: undefined,
        avatarUrl: 'https://example.com/avatar.png',
      };

      const result = await enrichWithDefaultImage(entity, mockGetFile);

      expect(mockGetFile).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: '',
        filepath: 'https://example.com/avatar.png',
        url: 'https://example.com/avatar.png',
      });
    });

    it('should handle entity without optional fields', async () => {
      const entity = {};

      const result = await enrichWithDefaultImage(entity, mockGetFile);

      expect(result).toBeNull();
      expect(mockGetFile).not.toHaveBeenCalled();
    });
  });

  describe('buildFileReference', () => {
    it('should build complete file reference for S3 file', () => {
      const file: FileEntry = {
        id: 'file-1',
        originalFilename: 'document.pdf',
        mimeType: 'application/pdf',
        size: 4096,
        storageKey: 's3://bucket/docs/document.pdf',
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = buildFileReference(file);

      expect(result).toEqual({
        id: 'file-1',
        filepath: '/api/v1/files/file-1',
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        size: 4096,
      });
    });

    it('should build file reference for legacy local file via API route', () => {
      const file: FileEntry = {
        id: 'file-2',
        originalFilename: 'image.jpg',
        mimeType: 'image/jpeg',
        size: 2048,
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = buildFileReference(file);

      expect(result).toEqual({
        id: 'file-2',
        filepath: '/api/v1/files/file-2',
        filename: 'image.jpg',
        mimeType: 'image/jpeg',
        size: 2048,
      });
    });

    it('should handle various file types', () => {
      const fileTypes = [
        { name: 'text.txt', mime: 'text/plain' },
        { name: 'video.mp4', mime: 'video/mp4' },
        { name: 'audio.mp3', mime: 'audio/mpeg' },
        { name: 'archive.zip', mime: 'application/zip' },
      ];

      fileTypes.forEach(({ name, mime }) => {
        const file: FileEntry = {
          id: 'file-test',
          originalFilename: name,
          mimeType: mime,
          size: 1024,
          storageKey: 's3://bucket/file',
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = buildFileReference(file);

        expect(result.filename).toBe(name);
        expect(result.mimeType).toBe(mime);
      });
    });

    it('should preserve file size', () => {
      const fileSizes = [0, 1, 1024, 1048576, 1073741824];

      fileSizes.forEach(size => {
        const file: FileEntry = {
          id: 'file-size-test',
          originalFilename: 'test.bin',
          mimeType: 'application/octet-stream',
          size,
          storageKey: 's3://bucket/file',
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = buildFileReference(file);
        expect(result.size).toBe(size);
      });
    });

    it('should build reference for file with complex filename', () => {
      const file: FileEntry = {
        id: 'file-3',
        originalFilename: 'my.complex.file.name.with.dots.txt',
        mimeType: 'text/plain',
        size: 512,
        storageKey: 's3://bucket/files/complex',
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = buildFileReference(file);

      expect(result).toEqual({
        id: 'file-3',
        filepath: '/api/v1/files/file-3',
        filename: 'my.complex.file.name.with.dots.txt',
        mimeType: 'text/plain',
        size: 512,
      });
    });
  });
});
