#!/bin/bash

FILES=(
  "app/aurora/[id]/edit/page.tsx"
  "app/aurora/[id]/view/components/CharacterDetails.tsx"
  "app/aurora/[id]/view/components/CharacterHeader.tsx"
  "app/aurora/[id]/view/components/ExternalPromptDialog.tsx"
  "app/aurora/[id]/view/components/ExternalPromptResultDialog.tsx"
  "app/aurora/[id]/view/components/SystemPromptsTab.tsx"
  "app/aurora/[id]/view/components/TagsTab.tsx"
  "app/aurora/[id]/view/page.tsx"
  "app/aurora/new/page.tsx"
  "app/files/page.tsx"
  "app/generate-image/page.tsx"
  "app/profile/page.tsx"
  "app/prospero/[id]/components/CharactersCard.tsx"
  "app/prospero/[id]/components/FilesCard.tsx"
  "app/prospero/[id]/components/ImageGenerationCard.tsx"
  "app/prospero/[id]/components/ModelBehaviorCard.tsx"
  "app/prospero/[id]/components/ProjectDetailHeader.tsx"
  "app/prospero/[id]/components/ProjectTabs.tsx"
  "app/prospero/[id]/components/SettingsCard.tsx"
  "app/prospero/[id]/components/SettingsTab.tsx"
  "app/prospero/components/DeleteProjectDialog.tsx"
  "app/prospero/page.tsx"
  "app/salon/new/page.tsx"
  "app/salon/page.tsx"
  "app/scriptorium/components/DocumentStoreCard.tsx"
  "components/characters/RenameReplaceTab.tsx"
  "components/characters/ai-wizard/AIWizardModal.tsx"
  "components/characters/ai-wizard/steps/FieldSelectionStep.tsx"
  "components/characters/ai-wizard/steps/ProfileSelectionStep.tsx"
  "components/characters/system-prompts-editor/index.tsx"
  "components/chat/BulkCharacterReplaceModal.tsx"
  "components/chat/ChatToolSettingsModal.tsx"
  "components/chat/DangerFlagBadge.tsx"
  "components/chat/LLMInspectorEntry.tsx"
  "components/chat/SpeakerSelector.tsx"
  "components/files/FileBrowser.tsx"
  "components/image-profiles/ProviderIcon.tsx"
  "components/images/PhotoGalleryModal.tsx"
  "components/quick-hide/hidden-placeholder.tsx"
  "components/settings/ai-import/AIImportWizard.tsx"
  "components/settings/appearance/components/ColorModeSelector.tsx"
  "components/settings/appearance/components/ThemeCard.tsx"
  "components/settings/embedding-profiles/ProfileList.tsx"
  "components/settings/plugins-tab.tsx"
  "components/setup-wizard/WizardStepIndicator.tsx"
  "components/tools/import-export/components/WizardCompleteStep.tsx"
  "components/tools/import-export/components/WizardErrorStep.tsx"
  "components/tools/import-export/steps/ImportCompleteStep.tsx"
  "components/tools/import-export/steps/ImportOptionsStep.tsx"
  "components/tools/llm-logs-card.tsx"
  "components/tools/search-replace/SearchReplaceModal.tsx"
  "components/ui/ErrorAlert.tsx"
  "components/wardrobe/wardrobe-item-card.tsx"
)

for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    # text-3xl font-bold -> qt-heading-1
    sed -i 's/text-3xl font-bold/qt-heading-1/g' "$f"
    # text-2xl font-semibold -> qt-heading-2
    sed -i 's/text-2xl font-semibold/qt-heading-2/g' "$f"
    # text-2xl font-bold -> qt-heading-2
    sed -i 's/text-2xl font-bold/qt-heading-2/g' "$f"
    # text-xl font-semibold -> qt-heading-3
    sed -i 's/text-xl font-semibold/qt-heading-3/g' "$f"
    # text-xl font-bold -> qt-heading-3
    sed -i 's/text-xl font-bold/qt-heading-3/g' "$f"
    # text-lg font-semibold -> qt-heading-4
    sed -i 's/text-lg font-semibold/qt-heading-4/g' "$f"
    # text-lg font-bold -> qt-heading-4
    sed -i 's/text-lg font-bold/qt-heading-4/g' "$f"
    # text-lg font-medium -> qt-text-section
    sed -i 's/text-lg font-medium/qt-text-section/g' "$f"
    # text-sm font-medium -> qt-label
    sed -i 's/text-sm font-medium/qt-label/g' "$f"
    # text-xs font-medium -> qt-text-label-xs
    sed -i 's/text-xs font-medium/qt-text-label-xs/g' "$f"
    echo "Processed: $f"
  fi
done
