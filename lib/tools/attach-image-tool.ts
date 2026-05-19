/**
 * @fileoverview Tool definition for `attach_image` — re-attaches a
 * previously kept image to the current outgoing message, so it renders for
 * everyone in the chat alongside the character's prose.
 */

export const attachImageTool = {
  type: 'function',
  function: {
    name: 'attach_image',
    description:
      "Re-attach an image you've previously kept (via keep_image) to your current message. Pass the uuid returned by keep_image or list_images. The image must live in your own photo album — to attach someone else's saved image, keep_image it first. The image renders inline in chat for any image-capable participant; non-image-capable models will see the stored prompt and caption in the tool result.",
    parameters: {
      type: 'object',
      properties: {
        uuid: {
          type: 'string',
          description: 'UUID of the kept image (the album link uuid returned by keep_image / list_images, or an image-v2 file uuid).',
        },
      },
      required: ['uuid'],
    },
  },
};

export function validateAttachImageInput(input: unknown): input is AttachImageInput {
  if (typeof input !== 'object' || input === null) return false;
  const o = input as Record<string, unknown>;
  return typeof o.uuid === 'string' && o.uuid.length > 0;
}

export interface AttachImageInput {
  uuid: string;
}

/**
 * Descriptor matching the shape `processToolCalls` accepts at
 * `lib/services/chat-message/tool-execution.service.ts:63-77`. Returned as
 * the lone element of `result: [descriptor]` so the image-generation
 * collector picks it up.
 */
export interface AttachedImageDescriptor {
  id: string;
  filename: string;
  filepath: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  sha256: string;
}
