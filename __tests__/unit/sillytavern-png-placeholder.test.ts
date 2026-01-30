/**
 * SillyTavern PNG Placeholder Generation Tests
 * Tests for createSTCharacterPNG with placeholder generation
 */

import { createSTCharacterPNG, parseSTCharacterPNG } from '@/lib/sillytavern/character';

describe('SillyTavern PNG Placeholder Generation', () => {
  const mockCharacter = {
    id: '123',
    name: 'Alice',
    description: 'A test character',
    personality: 'Friendly',
    scenario: 'Test scenario',
    firstMessage: 'Hello!',
    exampleDialogues: '',
    systemPrompts: [{
      id: 'prompt-1',
      name: 'Default',
      content: 'You are Alice',
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }],
    sillyTavernData: null,
  };

  describe('createSTCharacterPNG', () => {
    it('should create a valid PNG when no avatar buffer is provided', async () => {
      const buffer = await createSTCharacterPNG(mockCharacter);

      // PNG signature is 8 bytes starting with [137, 80, 78, 71, ...]
      expect(buffer[0]).toBe(137);
      expect(buffer[1]).toBe(80);
      expect(buffer[2]).toBe(78);
      expect(buffer[3]).toBe(71);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should create a PNG with character data embedded', async () => {
      const buffer = await createSTCharacterPNG(mockCharacter);

      // Try to parse the generated PNG
      const parsed = await parseSTCharacterPNG(buffer);
      expect(parsed).not.toBeNull();
      expect(parsed?.name).toBe('Alice');
    });

    it('should use provided avatar buffer when available', async () => {
      // Create a proper minimal PNG buffer
      const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      // Create minimal IHDR chunk (256x256, 8-bit RGB)
      const width = Buffer.alloc(4);
      width.writeUInt32BE(256);
      const height = Buffer.alloc(4);
      height.writeUInt32BE(256);
      const ihdrData = Buffer.concat([
        width,
        height,
        Buffer.from([8, 2, 0, 0, 0]), // bit depth, color type, compression, filter, interlace
      ]);

      // Calculate CRC (simplified - just use a placeholder)
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(0);

      // Create IHDR chunk
      const ihdrLength = Buffer.alloc(4);
      ihdrLength.writeUInt32BE(13);
      const ihdrChunk = Buffer.concat([
        ihdrLength,
        Buffer.from('IHDR'),
        ihdrData,
        crc,
      ]);

      // Create minimal IDAT chunk with one byte of data
      const idatLength = Buffer.alloc(4);
      idatLength.writeUInt32BE(1);
      const idatChunk = Buffer.concat([
        idatLength,
        Buffer.from('IDAT'),
        Buffer.from([0]),
        crc,
      ]);

      // Create IEND chunk
      const iendLength = Buffer.alloc(4);
      iendLength.writeUInt32BE(0);
      const iendChunk = Buffer.concat([
        iendLength,
        Buffer.from('IEND'),
        crc,
      ]);

      const avatarBuffer = Buffer.concat([pngSignature, ihdrChunk, idatChunk, iendChunk]);

      const buffer = await createSTCharacterPNG(mockCharacter, avatarBuffer);

      // Should still be valid PNG
      expect(buffer[0]).toBe(137);
      expect(buffer[1]).toBe(80);
    });

    it('should generate consistent placeholder PNG for same character name', async () => {
      const char1 = { ...mockCharacter, name: 'TestChar' };
      const char2 = { ...mockCharacter, name: 'TestChar' };

      const buffer1 = await createSTCharacterPNG(char1);
      const buffer2 = await createSTCharacterPNG(char2);

      // Same name should generate same placeholder (same hash color)
      expect(buffer1.length).toBe(buffer2.length);
    });

    it('should generate different placeholder colors for different character names', async () => {
      const charA = { ...mockCharacter, name: 'Alice' };
      const charB = { ...mockCharacter, name: 'Bob' };

      const bufferA = await createSTCharacterPNG(charA);
      const bufferB = await createSTCharacterPNG(charB);

      // Both should be valid PNGs with same basic structure
      expect(bufferA[0]).toBe(137);
      expect(bufferB[0]).toBe(137);
      
      // Buffers may have slightly different sizes due to compression differences
      // but should not be identical (different colors lead to different compressed data)
      expect(bufferA.equals(bufferB)).toBe(false);
    });

    it('should handle special characters in character names', async () => {
      const specialChars = [
        { ...mockCharacter, name: 'Alice 🎉' },
        { ...mockCharacter, name: 'Bob-123' },
        { ...mockCharacter, name: 'Charlie_Jones' },
        { ...mockCharacter, name: 'Über' },
      ];

      for (const char of specialChars) {
        const buffer = await createSTCharacterPNG(char);
        expect(buffer[0]).toBe(137); // PNG signature
        
        // Should be parseable
        const parsed = await parseSTCharacterPNG(buffer);
        expect(parsed).not.toBeNull();
        expect(parsed?.name).toBe(char.name);
      }
    });

    it('should handle empty character name gracefully', async () => {
      const charNoName = { ...mockCharacter, name: '' };
      const buffer = await createSTCharacterPNG(charNoName);

      expect(buffer[0]).toBe(137);
      const parsed = await parseSTCharacterPNG(buffer);
      expect(parsed).not.toBeNull();
    });

    it('should preserve character data in embedded JSON', async () => {
      const testChar = {
        ...mockCharacter,
        name: 'TestCharacter',
        description: 'Special description',
        personality: 'Unique personality',
      };

      const buffer = await createSTCharacterPNG(testChar);
      const parsed = await parseSTCharacterPNG(buffer);

      expect(parsed?.name).toBe('TestCharacter');
      expect(parsed?.description).toBe('Special description');
      expect(parsed?.personality).toBe('Unique personality');
    });

    it('should create 256x256 pixel placeholder PNG', async () => {
      const buffer = await createSTCharacterPNG(mockCharacter);

      // Check IHDR chunk for dimensions
      // PNG signature (8) + IHDR length (4) + type (4) + data (13) + CRC (4)
      // IHDR chunk contains width (4 bytes) and height (4 bytes) at the start
      const ihdrDataStart = 8 + 4 + 4; // After signature, length, and type
      const width = buffer.readUInt32BE(ihdrDataStart);
      const height = buffer.readUInt32BE(ihdrDataStart + 4);

      expect(width).toBe(256);
      expect(height).toBe(256);
    });

    it('should handle character with existing sillyTavernData', async () => {
      const charWithData = {
        ...mockCharacter,
        sillyTavernData: {
          name: 'Alice',
          description: 'A test character',
          personality: 'Friendly',
          scenario: 'Test scenario',
          first_mes: 'Hello!',
          mes_example: '',
          creator: 'Test Creator',
          tags: ['test'],
        },
      };

      const buffer = await createSTCharacterPNG(charWithData);
      const parsed = await parseSTCharacterPNG(buffer);

      expect(parsed?.creator).toBe('Test Creator');
      expect(parsed?.tags).toContain('test');
    });

    it('should embed character data in tEXt chunk', async () => {
      const buffer = await createSTCharacterPNG(mockCharacter);

      // Look for tEXt chunk keyword "chara"
      let foundTextChunk = false;
      let offset = 8; // Skip PNG signature

      while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);

        if (type === 'tEXt') {
          foundTextChunk = true;
          break;
        }

        offset += 12 + length; // length (4) + type (4) + data + CRC (4)
      }

      expect(foundTextChunk).toBe(true);
    });
  });

  describe('PNG validation', () => {
    it('should create files that pass PNG structure validation', async () => {
      const buffer = await createSTCharacterPNG(mockCharacter);

      // PNG signature
      const signature = buffer.subarray(0, 8);
      const expectedSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(signature.equals(expectedSig)).toBe(true);

      // Should have IHDR chunk
      let foundIHDR = false;
      let foundIDAT = false;
      let foundIEND = false;

      let offset = 8;
      while (offset < buffer.length) {
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        if (type === 'IHDR') foundIHDR = true;
        if (type === 'IDAT') foundIDAT = true;
        if (type === 'IEND') foundIEND = true;

        const length = buffer.readUInt32BE(offset);
        offset += 12 + length;
      }

      expect(foundIHDR).toBe(true);
      expect(foundIDAT).toBe(true);
      expect(foundIEND).toBe(true);
    });
  });

  describe('Round-trip parsing', () => {
    it('should preserve all character fields through PNG round-trip', async () => {
      const originalChar = {
        ...mockCharacter,
        name: 'TestChar',
        description: 'Test description',
        personality: 'Test personality',
        scenario: 'Test scenario',
        firstMessage: 'Test first message',
        exampleDialogues: 'Test examples',
      };

      // Create PNG with embedded character data
      const pngBuffer = await createSTCharacterPNG(originalChar);

      // Parse it back
      const parsed = await parseSTCharacterPNG(pngBuffer);

      expect(parsed?.name).toBe(originalChar.name);
      expect(parsed?.description).toBe(originalChar.description);
      expect(parsed?.personality).toBe(originalChar.personality);
      expect(parsed?.scenario).toBe(originalChar.scenario);
      expect(parsed?.first_mes).toBe(originalChar.firstMessage);
      expect(parsed?.mes_example).toBe(originalChar.exampleDialogues);
    });
  });
});
