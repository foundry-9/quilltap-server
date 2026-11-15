/**
 * Theme drafts — the only module that knows a draft is a folder under
 * `Themes/` in Quilltap General (Calliope Live, Spec D). Server only.
 *
 * @module lib/themes/drafts
 */

export {
  listDrafts,
  readDraft,
  createDraft,
  writeDraftTokens,
  deleteDraft,
  installDraft,
  draftServedSet,
  readDraftServedFile,
  draftIdFromName,
  bumpPatch,
  ThemeDraftNotFoundError,
  DraftRevisionConflictError,
  DraftManifestUnreadableError,
  DraftManifestRevisionConflictError,
  DraftManifestInvalidError,
  DraftOperationRefusedError,
  DraftFileInUseError,
  DraftNotInstallableError,
  DraftSourceNotFoundError,
  type DraftDetail,
  type DraftImageFile,
  type DraftFile,
  type DraftFileKind,
  type DraftFontFacts,
  type DraftTotals,
  type DraftIssue,
  type DraftSummary,
  type DraftServedSet,
  type DraftInstallResult,
} from './service';
export {
  addDraftFont,
  updateDraftFont,
  removeDraftFont,
  addDraftLicenceFile,
  addDraftImage,
  removeDraftFile,
  setDraftIcon,
  clearDraftIcon,
  setDraftSubsystem,
  setDraftManifestFields,
  readUploadedFont,
  type DraftUpload,
  type DraftManifestFields,
  type DraftSubsystemFields,
  type UpdateDraftFontFields,
  type UploadedFontReading,
} from './operations';
export { DraftUploadRefusedError, DRAFT_LIMITS, UPLOAD_EXTENSIONS } from './uploads';
export { ThemeDraftStoreUnavailableError } from './store';
export { THEME_DRAFTS_FOLDER, isValidDraftId, isThemeDraftStorePath } from './location';
