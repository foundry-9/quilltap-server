/**
 * Item pictures for the Atlas and the Inventory — the image half of the
 * item-store kernel (`createItemImages`). Their routes are adapters of the
 * shared `createItemImagesRoute` (`item-images-route.ts`) over a binding's
 * named exports.
 *
 * Each picture's bytes are a blob link under `<Family>/images/<id>/` in the
 * item's own tier mount, plus a `files` row (`linkedTo: [id]`, category
 * IMAGE). The history is `files.findByLinkedTo(id)`; the item's file carries
 * only the current pick, `imageFileId`. The generic steps (listing, the choice
 * check, removal, transfer carry) are the wardrobe's, called with the
 * family's images folder. An item with a parent (an Inventory instance) and
 * no pictures of its own shows its parent's, marked `inherited` (read-only).
 *
 * Generation is synchronous, in the calling API route, through the
 * Concierge's image failover chokepoint. The editor has no chat, so there is
 * no Locked state, no announcement and no ledger; the trail is returned for
 * the editor. What differs between the families is the binding's: the
 * subject prompt, the wording, the log type, and how a home is resolved.
 *
 * The Wardrobe keeps its own (`lib/wardrobe/item-images.ts`): its pictures
 * also link from other stored images and its generation is subject-optimised.
 *
 * Server-only.
 *
 * @module lib/mount-index/item-family-images
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { writeWardrobeItemImage, type WardrobeImageKind } from '@/lib/file-storage/wardrobe-image-bridge';
import { createGeneratedFileRow } from '@/lib/files/generated-file-row';
import { resolveAesthetic, getProjectOfficialMountPointId } from '@/lib/image-gen/aesthetic';
import { withArtDirection } from '@/lib/image-gen/avatar-prompt';
import { resolveWardrobeImageProfile } from '@/lib/image-gen/profile-resolution';
import { decodeProviderImage, makeLoggedImageAttempt } from '@/lib/image-gen/image-attempt';
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service';
import { generateImageWithConciergeFailover, getConciergeTrail } from '@/lib/services/dangerous-content/image-failover';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { RouteAttempt } from '@/lib/schemas/chat.types';
import type { FileEntry, FileSource } from '@/lib/schemas/file.types';
import type { ImageProfile } from '@/lib/schemas/types';
import {
  assertItemImageChoice,
  carryItemImages,
  cleanupItemImages,
  commitMovedImages,
  ForeignWardrobeImageError,
  listWardrobeItemImages,
  removeImageFile,
  toWardrobeImageSummary,
  type PendingImageMove,
  type WardrobeItemImageSummary,
} from '@/lib/wardrobe/item-images';
import type { ItemImagesScope } from '@/lib/mount-index/item-images-route';

export { ForeignWardrobeImageError as ForeignItemImageError };

/** A picture as the gallery shows it; `inherited` when it is the parent's. */
export type ItemImageSummary = WardrobeItemImageSummary & { inherited?: boolean };

/** The location surface a picture writes through. */
export interface ItemImageLocation<R> {
  scope: ItemImagesScope;
  id: string | null;
  characterId: string | null;
  writableMountPointId(): Promise<string>;
  update(id: string, patch: { imageFileId: string | null }): Promise<R | null>;
}

/** An item located in its tier, with the means to write it back. */
export interface ItemImageHome<R extends { id: string; imageFileId?: string | null }, I, L extends ItemImageLocation<R>> {
  location: L;
  record: R;
  /** The item as the family shows it (an Inventory instance resolved against its archetype). */
  item: I;
}

/** What a family binds. */
export interface ItemImagesConfig<R extends { id: string; imageFileId?: string | null }, I extends { id: string; imageFileId?: string | null }, L extends ItemImageLocation<R>> {
  kind: 'atlas' | 'inventory';
  /** `<Family>/images`, under the item's tier mount. */
  imagesFolder: string;
  /** Log tags, e.g. `'[AtlasImages]'` and `'[AtlasEntryImage]'`. */
  tags: { images: string; generation: string };
  /** What log lines and the stored description call one item, e.g. `'Atlas entry'`. */
  noun: string;
  /** The id key on log lines, e.g. `'entryId'`. */
  idKey: string;
  /** The stored picture's description. */
  describe(item: I): string;
  /** The `llm_logs` type a generation's attempts are logged under. */
  logType: Extract<Parameters<typeof makeLoggedImageAttempt>[0]['logType'], 'ATLAS_ENTRY_IMAGE' | 'INVENTORY_ITEM_IMAGE'>;
  /** The generation prompt for an item (before art direction). */
  buildPrompt(item: I): string;
  /** The 400 message when there is no image profile. */
  noProfileMessage: string;
  /** Error class names, e.g. `'NoAtlasImageProfileError'`, `'AtlasImageGenerationError'`. */
  errorNames: { noProfile: string; generation: string };
  /** An item's parent whose pictures show through when it has none (the Inventory's archetype). */
  parentOf?(item: I): string | null | undefined;
  /** Resolve a tier for a read (never provisions). */
  resolveLocation(scope: ItemImagesScope, containerId: string | null | undefined, repos: RepositoryContainer, userId: string): Promise<L | null>;
  /** Find a record in a tier. */
  find(location: L, id: string): Promise<R | null>;
  /** The item as the family shows it. */
  resolveItem(repos: RepositoryContainer, location: L, record: R): Promise<I>;
}

export interface AddItemImageInput {
  userId: string;
  kind: WardrobeImageKind;
  content: Buffer;
  contentType: string;
  width?: number | null;
  height?: number | null;
  generationPrompt?: string | null;
  generationModel?: string | null;
  generationRevisedPrompt?: string | null;
}

export interface ItemImageGenerationResult {
  fileId: string;
  prompt: string;
  profile: { id: string; name: string };
  rerouted: boolean;
  trail: RouteAttempt[] | null;
}

const SOURCE_BY_KIND: Record<WardrobeImageKind, FileSource> = {
  generated: 'GENERATED',
  uploaded: 'UPLOADED',
  imported: 'IMPORTED',
};

/** Bind the pictures of one family. */
export function createItemImages<
  R extends { id: string; imageFileId?: string | null },
  I extends { id: string; imageFileId?: string | null },
  L extends ItemImageLocation<R>,
>(config: ItemImagesConfig<R, I, L>) {
  type Home = ItemImageHome<R, I, L>;
  const { imagesFolder, tags, noun, idKey } = config;
  const LOG_CONTEXT = `${config.kind}.item-images`;
  const GEN_CONTEXT = `${config.kind}.item-image-generation`;

  /** No usable profile (a 400). */
  class NoProfileError extends Error {
    constructor() {
      super(config.noProfileMessage);
      this.name = config.errorNames.noProfile;
    }
  }

  /** The provider refused or failed; carries the trail. */
  class GenerationError extends Error {
    constructor(message: string, readonly trail: RouteAttempt[] | null, readonly refused: boolean) {
      super(message);
      this.name = config.errorNames.generation;
    }
  }

  /** The item's own pictures, newest first. */
  const list = (repos: Pick<RepositoryContainer, 'files'>, itemId: string): Promise<FileEntry[]> =>
    listWardrobeItemImages(repos, itemId);

  /** The pictures to show: the item's own, or — with none and a parent — the parent's, `inherited`. */
  async function listShown(repos: Pick<RepositoryContainer, 'files'>, item: I): Promise<ItemImageSummary[]> {
    const own = await list(repos, item.id);
    const parentId = config.parentOf?.(item);
    if (own.length > 0 || !parentId) return own.map(toWardrobeImageSummary);
    const inherited = await list(repos, parentId);
    logger.debug(`${tags.images} Item shows its parent's pictures`, {
      context: LOG_CONTEXT,
      [idKey]: item.id,
      parentId,
      count: inherited.length,
    });
    return inherited.map((file) => ({ ...toWardrobeImageSummary(file), inherited: true }));
  }

  /** Refuse an `imageFileId` that is not one of the item's own pictures. */
  const assertChoice = (repos: Pick<RepositoryContainer, 'files'>, itemId: string, fileId: string | null | undefined) =>
    assertItemImageChoice(repos, itemId, fileId);

  /** Store a new picture for the item and make it current. */
  async function add(repos: RepositoryContainer, home: Home, input: AddItemImageInput): Promise<{ file: FileEntry; record: R | null }> {
    const mountPointId = await home.location.writableMountPointId();
    const written = await writeWardrobeItemImage({
      mountPointId,
      itemId: home.record.id,
      kind: input.kind,
      content: input.content,
      contentType: input.contentType,
      description: config.describe(home.item),
      imagesFolder,
    });
    const file = await createGeneratedFileRow(repos, {
      userId: input.userId,
      sha256: written.sha256,
      originalFilename: written.leafName,
      stored: written,
      width: input.width ?? null,
      height: input.height ?? null,
      linkedTo: [home.record.id],
      tags: [home.record.id],
      source: SOURCE_BY_KIND[input.kind],
      generation: {
        prompt: input.generationPrompt ?? null,
        model: input.generationModel ?? null,
        revisedPrompt: input.generationRevisedPrompt ?? null,
      },
    });
    const record = await home.location.update(home.record.id, { imageFileId: file.id });
    logger.info(`${tags.images} Added ${noun} picture`, {
      context: LOG_CONTEXT,
      scope: home.location.scope,
      [idKey]: home.record.id,
      fileId: file.id,
      kind: input.kind,
      sizeBytes: written.sizeBytes,
    });
    return { file, record };
  }

  /** Make one of the item's own pictures current. */
  async function setCurrent(repos: RepositoryContainer, home: Home, fileId: string): Promise<string> {
    await assertChoice(repos, home.record.id, fileId);
    await home.location.writableMountPointId();
    await home.location.update(home.record.id, { imageFileId: fileId });
    logger.debug(`${tags.images} Set current ${noun} picture`, { context: LOG_CONTEXT, [idKey]: home.record.id, fileId });
    return fileId;
  }

  /** Delete one of the item's pictures; the next-newest becomes current. */
  async function remove(repos: RepositoryContainer, home: Home, fileId: string): Promise<string | null> {
    const images = await list(repos, home.record.id);
    const target = images.find((f) => f.id === fileId);
    if (!target) throw new ForeignWardrobeImageError(home.record.id, fileId);
    await home.location.writableMountPointId();
    await removeImageFile(repos, home.record.id, target, imagesFolder);
    let current = home.record.imageFileId ?? null;
    if (current === fileId || (current && !images.some((f) => f.id === current))) {
      current = images.find((f) => f.id !== fileId)?.id ?? null;
      await home.location.update(home.record.id, { imageFileId: current });
    }
    logger.info(`${tags.images} Deleted ${noun} picture`, { context: LOG_CONTEXT, [idKey]: home.record.id, fileId, current });
    return current;
  }

  /** Find an item in the named tier, or null. A read: nothing is provisioned. */
  async function resolveHome(
    repos: RepositoryContainer,
    userId: string,
    scope: ItemImagesScope,
    containerId: string | null | undefined,
    itemId: string,
  ): Promise<Home | null> {
    const location = await config.resolveLocation(scope, containerId, repos, userId);
    if (!location) return null;
    const record = await config.find(location, itemId);
    if (!record) return null;
    return { location, record, item: await config.resolveItem(repos, location, record) };
  }

  /** Generate, store and make current a picture of `home.item`. */
  async function generate(
    repos: RepositoryContainer,
    args: { userId: string; home: Home; imageProfileId?: string | null },
  ): Promise<ItemImageGenerationResult> {
    const { userId, home } = args;
    // Refuse a tombstone before spending a provider call.
    await home.location.writableMountPointId();

    const profile = (await resolveWardrobeImageProfile(userId, repos, args.imageProfileId)) as ImageProfile | null;
    if (!profile || !profile.apiKeyId) throw new NoProfileError();
    const apiKey = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId);
    if (!apiKey?.key_value) throw new NoProfileError();

    const projectMount = home.location.scope === 'project' ? await getProjectOfficialMountPointId(home.location.id) : null;
    const prompt = withArtDirection(
      config.buildPrompt(home.item),
      await resolveAesthetic({ kind: 'lantern', projectOfficialMountPointId: projectMount ?? undefined }),
    );
    logger.debug(`${tags.generation} Generating ${noun} picture`, {
      context: GEN_CONTEXT,
      [idKey]: home.record.id,
      scope: home.location.scope,
      profileId: profile.id,
    });

    const conciergePolicy = resolveConciergeSettings((await repos.chatSettings.findByUserId(userId)) ?? null, null);
    const attempt = makeLoggedImageAttempt({
      userId,
      logType: config.logType,
      prompt,
      primaryProfileId: profile.id,
      chatId: null,
      characterId: home.location.characterId,
      params: {
        overrides: { n: 1, style: 'natural' },
        orientation: 'square',
        logContext: { context: GEN_CONTEXT, [idKey]: home.record.id },
      },
    });

    let failover;
    try {
      failover = await generateImageWithConciergeFailover(
        { profile, apiKey: apiKey.key_value },
        attempt,
        { userId, chatId: null, chat: null, purpose: 'dialog', conciergePolicy, primaryVia: 'primary' },
      );
    } catch (error) {
      const trail = getConciergeTrail(error);
      const refused = !!trail && trail.some((row) => row.outcome === 'refused');
      logger.warn(`${tags.generation} ${noun} picture generation failed`, {
        context: GEN_CONTEXT,
        [idKey]: home.record.id,
        error: getErrorMessage(error),
        refused,
      });
      throw new GenerationError(getErrorMessage(error), trail, refused);
    }

    const decoded = await decodeProviderImage(failover.result, config.kind);
    if (!decoded) {
      throw new GenerationError('The image provider returned no picture', failover.trail.length ? failover.trail : null, false);
    }
    const { file } = await add(repos, home, {
      userId,
      kind: 'generated',
      content: decoded.buffer,
      contentType: decoded.mimeType,
      width: decoded.width,
      height: decoded.height,
      generationPrompt: prompt,
      generationModel: failover.profile.modelName,
      generationRevisedPrompt: decoded.revisedPrompt,
    });
    logger.info(`${tags.generation} ${noun} picture generated`, {
      context: GEN_CONTEXT,
      [idKey]: home.record.id,
      fileId: file.id,
      profileId: failover.profile.id,
      rerouted: failover.rerouted,
    });
    return {
      fileId: file.id,
      prompt,
      profile: { id: failover.profile.id, name: failover.profile.name },
      rerouted: failover.rerouted,
      trail: failover.trail.length > 0 ? failover.trail : null,
    };
  }

  return {
    imagesFolder,
    list,
    listShown,
    assertChoice,
    add,
    setCurrent,
    remove,
    resolveHome,
    generate,
    NoProfileError,
    GenerationError,
    /** Drop every picture of a deleted item. Logs, never throws. */
    cleanup: (repos: RepositoryContainer, itemId: string, logTag: string, meta: Record<string, unknown>) =>
      cleanupItemImages(repos, itemId, logTag, meta, imagesFolder),
    /** Carry an item's pictures to another mount for a transfer. */
    carry: (
      repos: RepositoryContainer,
      args: { mode: 'move' | 'copy'; sourceItemId: string; destinationItemId: string; destinationMountPointId: string; userId: string },
    ): Promise<{ fileIdMap: Map<string, string>; pendingMove: PendingImageMove }> =>
      carryItemImages(repos, { ...args, imagesFolder }),
    /** Finish a move's pictures once the item has landed. */
    commitMoved: (repos: Pick<RepositoryContainer, 'files'>, itemId: string, pending: PendingImageMove) =>
      commitMovedImages(repos, itemId, pending, imagesFolder),
  };
}

/** One family's bound pictures. */
export type ItemImages<R extends { id: string; imageFileId?: string | null }, I extends { id: string; imageFileId?: string | null }, L extends ItemImageLocation<R>> =
  ReturnType<typeof createItemImages<R, I, L>>;
